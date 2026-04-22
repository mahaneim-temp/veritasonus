/**
 * GoogleProvider — Cloud Speech-to-Text streaming + Cloud Translation.
 *
 * 동작:
 *   1) PCM16 16k mono 스트림을 STT 에 흘려보냄 (LINEAR16 config).
 *   2) STT 가 isFinal=true 결과를 주면, 원문 emit → Translation API 로 번역 호출 → 번역 emit.
 *   3) Partial (isFinal=false) 은 emitRaw 로 forward — UI 가 원하면 보여줄 수 있게.
 *   4) Google STT 는 단일 스트림 최대 ~5분 제한 → 4분 50초마다 자동 재시작.
 *
 * 인증:
 *   - 서비스 계정 JSON 을 `GOOGLE_SERVICE_ACCOUNT_JSON` env 에 넣어 준다.
 *     (로컬 개발: GOOGLE_APPLICATION_CREDENTIALS 로 파일 경로를 줘도 됨 — SDK 기본 동작.)
 *
 * Assist 는 Gemini 로 처리 (providers/gemini.ts).
 */

import speech from "@google-cloud/speech";
import { v2 as translateV2 } from "@google-cloud/translate";
import type {
  ProviderEmitter,
  ProviderHandle,
  ProviderStartOptions,
  RealtimeProvider,
} from "./types.js";
import { runAssist } from "./gemini.js";
import { ENV } from "../env.js";

/** google-gax 의 ClientOptions 는 index signature 를 요구. 실제 SDK 타입은 transitive
 *  dep 으로만 접근 가능해 여기서는 최소 필드만 정의하고 SDK 경계에서 타입 단언. */
interface GoogleClientOptions {
  credentials?: { client_email: string; private_key: string };
  projectId?: string;
}

type SpeechClient = InstanceType<typeof speech.SpeechClient>;
// 동적으로 생성하는 gRPC 스트림 — ts 타입이 복잡해 any 로 래핑하고 런타임에 가드.
type SttStream = {
  write: (chunk: Buffer) => void;
  destroy: () => void;
  on: (event: string, cb: (arg?: unknown) => void) => void;
  removeAllListeners: () => void;
};

const STREAM_RESTART_MS = 4 * 60 * 1000 + 50 * 1000; // 4:50 — Google 5분 제한 여유분

let _sttClient: SpeechClient | null = null;
let _translateClient: translateV2.Translate | null = null;

function credentials(): GoogleClientOptions {
  const raw = process.env["GOOGLE_SERVICE_ACCOUNT_JSON"];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as {
        client_email?: string;
        private_key?: string;
        project_id?: string;
      };
      if (parsed.client_email && parsed.private_key) {
        return {
          credentials: {
            client_email: parsed.client_email,
            private_key: parsed.private_key,
          },
          projectId: parsed.project_id,
        } as GoogleClientOptions;
      }
    } catch {
      // GOOGLE_APPLICATION_CREDENTIALS 경로 fallback 에 맡긴다.
    }
  }
  return {} as GoogleClientOptions; // SDK 가 GOOGLE_APPLICATION_CREDENTIALS 또는 ADC 사용.
}

function sttClient(): SpeechClient {
  if (_sttClient) return _sttClient;
  // SDK 의 ClientOptions 는 index signature 를 요구하지만 우리는 사용하는 필드만 명시.
  _sttClient = new speech.SpeechClient(credentials() as never);
  return _sttClient;
}

function translateClient(): translateV2.Translate {
  if (_translateClient) return _translateClient;
  _translateClient = new translateV2.Translate(credentials() as never);
  return _translateClient;
}

/** 'ko' → 'ko-KR' 등. Google STT 는 BCP-47 요구. */
function toBcp47(lang: string): string {
  const l = lang.toLowerCase();
  if (l.includes("-")) return lang; // 이미 BCP-47
  const map: Record<string, string> = {
    ko: "ko-KR",
    en: "en-US",
    ja: "ja-JP",
    zh: "zh-CN",
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
  };
  return map[l] ?? lang;
}

class GoogleSession implements ProviderHandle {
  private stream: SttStream | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private lastFinalSeq = 0;

  constructor(private readonly opts: ProviderStartOptions) {}

  async open(): Promise<void> {
    this.openStream();
  }

  private openStream(): void {
    if (this.closed) return;
    const languageCode = toBcp47(this.opts.sourceLang);
    const request = {
      config: {
        encoding: "LINEAR16" as const,
        sampleRateHertz: 16000,
        languageCode,
        enableAutomaticPunctuation: true,
        model: "latest_long",
      },
      interimResults: true,
    };

    const stream = sttClient()
      .streamingRecognize(request as never) as unknown as SttStream;
    this.stream = stream;

    stream.on("error", (errArg) => {
      const err = errArg as Error & { code?: number };
      // 스트림 limit(5분) 도달은 정상 재시작 신호.
      if (err?.code === 11 /* OUT_OF_RANGE */) {
        this.opts.log.info("google_stt_stream_time_limit_restart");
        this.restart();
        return;
      }
      this.opts.log.error({ err: String(err) }, "google_stt_error");
      this.opts.emit.onError("google_stt_error", String(err));
    });

    stream.on("data", (dataArg) => {
      const data = dataArg as GoogleSttResponse;
      const result = data?.results?.[0];
      if (!result || !result.alternatives?.[0]) return;
      const text = result.alternatives[0].transcript ?? "";
      if (!text.trim()) return;

      if (!result.isFinal) {
        // partial — 클라이언트에 흘려보내기만.
        this.opts.emit.emitRaw({
          type: "speech_partial",
          seq: this.lastFinalSeq + 1,
          text,
        });
        return;
      }

      // final → 번역 호출
      const confidence = result.alternatives[0].confidence ?? null;
      this.opts.emit.onSourceFinal(text, confidence);
      this.lastFinalSeq += 1;
      const currentSeq = this.lastFinalSeq;

      void this.translateAndEmit(text, currentSeq);
    });

    stream.on("end", () => {
      this.opts.log.info("google_stt_stream_end");
    });

    // 4:50 마다 재시작 (Google 5분 하드 리밋).
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(
      () => this.restart(),
      STREAM_RESTART_MS,
    );
  }

  private async translateAndEmit(text: string, _seq: number): Promise<void> {
    try {
      const target = this.opts.targetLang.split("-")[0] ?? this.opts.targetLang; // 'en', 'ko' 등
      const [translated] = await translateClient().translate(text, target);
      this.opts.emit.onTranslationFinal(translated);
    } catch (e) {
      this.opts.log.warn({ err: String(e) }, "google_translate_failed");
      // 번역 실패해도 원문은 이미 emit 됨. 빈 번역으로 대체.
      this.opts.emit.onTranslationFinal("");
    }
  }

  private restart(): void {
    if (this.closed) return;
    const prev = this.stream;
    this.stream = null;
    if (prev) {
      try {
        prev.removeAllListeners();
        prev.destroy();
      } catch {
        // ignore
      }
    }
    this.openStream();
  }

  sendAudio(chunk: Buffer): void {
    const s = this.stream;
    if (!s) return;
    try {
      s.write(chunk);
    } catch (e) {
      this.opts.log.warn({ err: String(e) }, "google_stt_write_failed");
    }
  }

  commit(): void {
    // Google streaming 은 명시적 commit 이 없다. 자동 endpoint detection.
  }

  interrupt(): void {
    // 번역은 단일 HTTP 호출이라 interrupt 의미 없음 — no-op.
  }

  async assist(intent: string, priorText?: string): Promise<void> {
    try {
      const text = await runAssist(intent, priorText);
      this.opts.emit.onAssistText(text);
    } catch (e) {
      this.opts.log.warn({ err: String(e) }, "gemini_assist_failed");
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const s = this.stream;
    this.stream = null;
    if (s) {
      try {
        s.removeAllListeners();
        s.destroy();
      } catch {
        // ignore
      }
    }
  }
}

interface GoogleSttResponse {
  results?: Array<{
    isFinal?: boolean;
    alternatives?: Array<{
      transcript?: string;
      confidence?: number;
    }>;
  }>;
}

export const GoogleProvider: RealtimeProvider = {
  name: "google",
  async start(opts) {
    if (!ENV.GOOGLE_AI_API_KEY && !process.env["GOOGLE_SERVICE_ACCOUNT_JSON"]) {
      opts.log.warn(
        "google_provider_missing_credentials — expected GOOGLE_SERVICE_ACCOUNT_JSON",
      );
    }
    const session = new GoogleSession(opts);
    await session.open();
    return session;
  },
};

export { GoogleSession as _GoogleSessionForTest };

// Provider 인터페이스 준수를 위한 재익스포트 (emit 타입 참조).
export type { ProviderEmitter };
