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
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ProviderEmitter,
  ProviderHandle,
  ProviderStartOptions,
  RealtimeProvider,
} from "./types.js";
import { runAssist } from "./gemini.js";
import { ENV } from "../env.js";
import type { Database } from "../db-types.js";
import { extractBiasPhrases } from "../biasing.js";

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
let _sb: SupabaseClient<Database> | null = null;
function sb(): SupabaseClient<Database> {
  if (_sb) return _sb;
  _sb = createClient<Database>(
    ENV.SUPABASE_URL,
    ENV.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _sb;
}

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

/**
 * 'ko' → 'ko-KR' 등. Google Cloud STT 는 BCP-47 요구.
 * 주의: LANGS SSOT(src/lib/constants/languages.ts) 와 동기화 필수.
 *   SSOT 에 새 언어 추가 시 반드시 여기에도 매핑 추가.
 *   매핑 누락 시 Google STT 가 raw 코드 (예: "tl") 받고 조용히 실패 → 음성이 먹통처럼 보이는 버그.
 *
 * Google STT 공식 지원 BCP-47 (2025 기준, 주요):
 *   - fil-PH (타갈로그/필리핀어) — Google 은 "tl" 미지원, "fil-PH" 만 수락
 *   - cmn-Hans-CN / zh-CN 모두 허용 — 표준 중국어(간체)
 *   - yue-Hant-HK 광둥어, cmn-Hant-TW 대만화 등은 필요 시 별도 추가
 */
/**
 * Google STT 의 `latest_long` 모델이 공식 지원하는 BCP-47 코드 화이트리스트.
 *
 * 왜 필요한가:
 *   latest_long 은 발화 길이가 긴 회의/연설용 고정밀 모델이지만, 주요 언어 외에는 제공되지 않는다.
 *   미지원 언어(예: fil-PH, th-TH, hi-IN, vi-VN, id-ID, ar-SA)에 latest_long 을 강제하면
 *   INVALID_ARGUMENT 로 스트림이 즉시 죽는다 → FATAL_PROVIDER_CODES 에 걸려 WS close →
 *   클라이언트 재연결 루프. 화면에는 "재연결 중" 만 반복 표시되어 사용자는 원인을 알 수 없다.
 *
 * 전략:
 *   - 화이트리스트에 있는 언어 → latest_long (품질 우선)
 *   - 나머지 언어 → model 필드 생략, SDK 가 default 모델 선택 (호환성 우선)
 *
 * 참고(2024~2025 Google Cloud Speech v1/v1p1beta1 공개 지원 목록):
 *   en-x, ko-KR, ja-JP, cmn-x / zh-x, es-x, fr-x, de-DE, pt-x, it-IT, ru-RU.
 *   이외 언어는 Google 문서에 별도 명시가 없어 default 로 돌린다.
 */
const LATEST_LONG_SUPPORTED: ReadonlySet<string> = new Set([
  "en-US",
  "en-GB",
  "en-AU",
  "en-IN",
  "en-CA",
  "ko-KR",
  "ja-JP",
  "zh-CN",
  "cmn-Hans-CN",
  "cmn-Hant-TW",
  "zh-TW",
  "es-ES",
  "es-US",
  "es-MX",
  "fr-FR",
  "fr-CA",
  "de-DE",
  "pt-BR",
  "pt-PT",
  "it-IT",
  "ru-RU",
]);

function supportsLatestLong(languageCode: string): boolean {
  return LATEST_LONG_SUPPORTED.has(languageCode);
}

function toBcp47(lang: string): string {
  const l = lang.toLowerCase();
  if (l.includes("-")) return lang; // 이미 BCP-47
  const map: Record<string, string> = {
    ko: "ko-KR",
    en: "en-US",
    ja: "ja-JP",
    zh: "zh-CN",
    tl: "fil-PH", // Google STT 는 "tl" 을 직접 받지 않는다 — "fil-PH" 필수.
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
    id: "id-ID",
    vi: "vi-VN",
    th: "th-TH",
    pt: "pt-BR",
    ru: "ru-RU",
    hi: "hi-IN",
    ar: "ar-SA",
    it: "it-IT",
  };
  return map[l] ?? lang;
}

class GoogleSession implements ProviderHandle {
  private stream: SttStream | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private lastFinalSeq = 0;
  /** 파싱된 자료에서 뽑은 biasing phrases. open() 에서 1회 계산 후 재시작 때마다 재사용. */
  private biasPhrases: string[] = [];
  /** 첫 오디오 byte 수신 여부 — 관측/진단용 로그 1회만 찍는다. */
  private loggedFirstAudio = false;
  /** 첫 STT final 결과 수신 여부 — 관측/진단용 로그 1회만. */
  private loggedFirstFinal = false;
  /** 연속 write 실패 회수 — 임계값 초과 시 fatal 로 상향. */
  private writeFailCount = 0;

  constructor(private readonly opts: ProviderStartOptions) {}

  async open(): Promise<void> {
    await this.loadBiasPhrases();
    this.openStream();
  }

  /**
   * 해당 세션의 파싱 완료된 session_assets.extracted_text 를 긁어 phrase 목록 생성.
   * STT 스트림을 열기 전에 1회 호출 — Google Cloud 호출은 필요 없음 (DB 만).
   */
  private async loadBiasPhrases(): Promise<void> {
    try {
      const { data, error } = await sb()
        .from("session_assets")
        .select("extracted_text,asset_type")
        .eq("session_id", this.opts.sessionId)
        .eq("parse_status", "done")
        .not("extracted_text", "is", null);
      if (error) throw error;
      const texts = (data ?? [])
        .map((row) => (row.extracted_text ?? "") as string)
        .filter((s) => s.length > 0);
      if (texts.length === 0) {
        this.biasPhrases = [];
        return;
      }
      this.biasPhrases = extractBiasPhrases(texts);
      this.opts.log.info(
        {
          session: this.opts.sessionId,
          assets: texts.length,
          phrases: this.biasPhrases.length,
        },
        "biasing_loaded",
      );
    } catch (e) {
      this.opts.log.warn(
        { err: String(e), session: this.opts.sessionId },
        "biasing_load_failed",
      );
      this.biasPhrases = [];
    }
  }

  private openStream(): void {
    if (this.closed) return;
    const languageCode = toBcp47(this.opts.sourceLang);
    // 매핑 결과를 로그로 남긴다 — 추후 언어 추가 시 "음성 안 먹음" 증상을 빠르게 진단.
    this.opts.log.info(
      {
        session: this.opts.sessionId,
        sourceLang: this.opts.sourceLang,
        languageCode,
        targetLang: this.opts.targetLang,
        model: supportsLatestLong(languageCode) ? "latest_long" : "default",
      },
      "google_stt_opening",
    );
    const useLatestLong = supportsLatestLong(languageCode);
    const config: Record<string, unknown> = {
      encoding: "LINEAR16",
      sampleRateHertz: 16000,
      languageCode,
      enableAutomaticPunctuation: true,
    };
    // 지원 언어만 latest_long 주입. 미지원 언어(fil-PH, th-TH, hi-IN …) 에는 붙이지 않는다 —
    // 붙이면 INVALID_ARGUMENT 로 즉시 스트림 사망 → 클라 재연결 루프.
    if (useLatestLong) {
      config["model"] = "latest_long";
    }
    // Biasing: 파싱된 원고/용어집을 phrase hint 로 주입. boost 는 mild(10).
    if (this.biasPhrases.length > 0) {
      config["speechContexts"] = [
        { phrases: this.biasPhrases, boost: 10 },
      ];
    }
    const request = { config, interimResults: true };

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

      // final → 원문만 emit. 번역은 세션 핸들러가 병합 판단 후 translate() 로 별도 호출.
      if (!this.loggedFirstFinal) {
        this.loggedFirstFinal = true;
        this.opts.log.info(
          { session: this.opts.sessionId, first_text_preview: text.slice(0, 40) },
          "google_stt_first_final",
        );
      }
      const confidence = result.alternatives[0].confidence ?? null;
      this.opts.emit.onSourceFinal(text, confidence);
      this.lastFinalSeq += 1;
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

  async translate(text: string): Promise<string> {
    const body = text.trim();
    if (!body) return "";
    try {
      const target = this.opts.targetLang.split("-")[0] ?? this.opts.targetLang;
      const [translated] = await translateClient().translate(body, target);
      return translated;
    } catch (e) {
      this.opts.log.warn({ err: String(e) }, "google_translate_failed");
      return "";
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
    if (!this.loggedFirstAudio) {
      this.loggedFirstAudio = true;
      this.opts.log.info(
        { session: this.opts.sessionId, bytes: chunk.length },
        "google_stt_first_audio",
      );
    }
    try {
      s.write(chunk);
      // write 성공 → 실패 카운터 리셋.
      if (this.writeFailCount > 0) this.writeFailCount = 0;
    } catch (e) {
      this.writeFailCount += 1;
      this.opts.log.warn(
        { err: String(e), failCount: this.writeFailCount },
        "google_stt_write_failed",
      );
      // 연속 3회 실패면 스트림이 사실상 죽은 것. onError 를 올려 세션 핸들러가
      // FATAL 처리(WS close → 클라 재연결) 하도록 한다.
      if (this.writeFailCount >= 3) {
        this.writeFailCount = 0; // 중복 방출 방지.
        try {
          this.opts.emit.onError("google_stt_write_failed", String(e));
        } catch {
          // ignore
        }
      }
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
