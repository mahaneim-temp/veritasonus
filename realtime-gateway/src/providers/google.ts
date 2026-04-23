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

/**
 * 부분 결과(speech_partial) 를 클라로 중계할 최소 stability 임계값.
 *
 * 배경:
 *   Google STT 는 interim 결과의 "이 추정이 바뀌지 않을 확률"을 stability(0.0~1.0) 필드로 준다.
 *   필터 없이 전부 forward 하면 빠른 말(특히 뉴스 낭독, 중국어/영어/일본어) 에서
 *   "오늘은 → 그제는 → 그제 비가" 식 재해석 갱신이 그대로 화면에 깜빡임으로 보인다.
 *
 *   stability < 0.5 는 Google 내부가 곧 뒤집을 확률이 높은 "초기 추정" — 이걸 막으면
 *   화면은 조금 덜 반응적으로 보여도 깜빡임/되돌림 현상이 거의 사라진다. 언어 무관.
 *
 *   이 임계값은 forward 에만 적용되며, 내부 state(fullPartialText) 는 stability 와 무관하게 계속 추적한다
 *   — soft-final 타이머가 누적 텍스트로 커밋을 결정하기 때문.
 */
const PARTIAL_STABILITY_MIN = 0.5;

/**
 * isFinal 없이 partial 만 흘러오는 시간이 이 값을 넘으면 현재까지의 partial 을 "soft-final" 로 강제 커밋.
 *
 * 왜 필요:
 *   Google 의 endpoint 감지는 "호흡 수준의 무음" 을 기준으로 작동. 빠른 연속 발화(뉴스 낭독 등) 에서는
 *   10~20 초간 isFinal 이 안 나올 수 있다. 현 구조상 commitFinal → translate 는 isFinal 에서만 호출되므로,
 *   isFinal 이 늦으면 번역도 함께 밀려 "문장만 쌓이고 번역이 안 된다" 는 체감 증상으로 나타남. 언어 무관.
 *
 *   4 초 정도면 짧은 단위로 끊어 번역을 흘려보낼 수 있고, 너무 짧지 않아 자연스러운 호흡이 잡히면
 *   그 호흡에서 진짜 isFinal 이 먼저 나오게 된다.
 */
const SOFT_FINAL_AFTER_MS = 4000;

/**
 * soft-final 로 커밋할 때, 아직 커밋되지 않은 delta 가 이 글자 수 이상이어야 commit.
 *
 * 너무 짧으면(한두 글자) 한글/일본어의 조사·어미만 쪼개져 번역 품질이 망가진다.
 * 세션 핸들러의 merge 버퍼(3~6자) 와 겹치지 않도록 그보다 살짝 높게.
 */
const SOFT_FINAL_MIN_DELTA_CHARS = 4;

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
  // 중국어 별칭(zh-CN, zh-TW, zh-HK) 도 Google 정규 코드로 재매핑 — Google STT 는
  // zh-* 를 직접 수락하지 않는다 (공식 지원은 cmn-Hans-CN / cmn-Hant-TW / yue-Hant-HK).
  if (l === "zh-cn" || l === "zh-hans" || l === "zh-hans-cn") return "cmn-Hans-CN";
  if (l === "zh-tw" || l === "zh-hant" || l === "zh-hant-tw") return "cmn-Hant-TW";
  if (l === "zh-hk" || l === "yue" || l === "yue-hk") return "yue-Hant-HK";
  if (l.includes("-")) return lang; // 이미 BCP-47 (위에서 걸러지지 않은 정상 코드)
  const map: Record<string, string> = {
    ko: "ko-KR",
    en: "en-US",
    ja: "ja-JP",
    // 중국어는 Google 공식 지원이 cmn-Hans-CN (간체, 중국) — zh-CN 은 거부당한다.
    zh: "cmn-Hans-CN",
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
  /**
   * 이미 onSourceFinal 로 커밋된 partial 의 전체-텍스트 상태(Google 이 준 raw 누적 텍스트 기준).
   * 다음 partial/real-final 의 rawText 에서 이 prefix 를 잘라낸 "delta" 만 emit 해야 중복이 없다.
   * real-final 이 도착하면 "" 로 리셋.
   */
  private committedPrefix = "";
  /**
   * 마지막 commit(soft/real) 이 이루어진 wall-clock 시각(ms).
   * 긴 연속 발화에서 SOFT_FINAL_AFTER_MS 를 넘겼는지 판단.
   */
  private lastCommitMs = 0;

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
    // 스트림을 새로 열 때마다 partial 누적 상태 리셋 — 직전 스트림 말미의 jank 를 가져오지 않는다.
    // (lastFinalSeq 는 세션 전역이라 유지. 아래 두 값은 stream-local.)
    this.committedPrefix = "";
    this.lastCommitMs = Date.now();
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
      const rawText = (result.alternatives[0].transcript ?? "").trim();
      if (!rawText) return;

      if (!result.isFinal) {
        // ── 1) 이미 soft-final 로 커밋한 prefix 는 잘라내 delta 만 다룬다. ──
        //      Google partial 은 isFinal 이후 새 utterance 를 시작할 때까지 누적되는
        //      "현재 utterance 의 전체 텍스트" 이기 때문.
        let deltaText = rawText;
        if (
          this.committedPrefix &&
          rawText.startsWith(this.committedPrefix)
        ) {
          deltaText = rawText.slice(this.committedPrefix.length).trim();
        }
        if (!deltaText) return;

        // ── 2) 클라로 forward 는 stability 이상일 때만. 깜빡임 방지(언어 무관). ──
        const stability = result.stability ?? 1;
        if (stability >= PARTIAL_STABILITY_MIN) {
          this.opts.emit.emitRaw({
            type: "speech_partial",
            seq: this.lastFinalSeq + 1,
            text: deltaText,
          });
        }

        // ── 3) soft-final: 너무 오래 isFinal 이 안 나오면 현재까지의 delta 를 강제 커밋. ──
        //      언어마다 Google endpoint 감도가 달라 빠른 뉴스 낭독에서는 수십 초간 isFinal 미발생
        //      → 번역이 전혀 트리거되지 않는 현상. 4초 타임박스로 bound.
        if (this.lastCommitMs === 0) this.lastCommitMs = Date.now();
        const now = Date.now();
        if (
          deltaText.length >= SOFT_FINAL_MIN_DELTA_CHARS &&
          now - this.lastCommitMs >= SOFT_FINAL_AFTER_MS
        ) {
          this.opts.log.info(
            {
              session: this.opts.sessionId,
              chars: deltaText.length,
              age_ms: now - this.lastCommitMs,
              preview: deltaText.slice(0, 40),
            },
            "google_stt_soft_final_commit",
          );
          if (!this.loggedFirstFinal) {
            this.loggedFirstFinal = true;
            this.opts.log.info(
              {
                session: this.opts.sessionId,
                first_text_preview: deltaText.slice(0, 40),
                kind: "soft",
              },
              "google_stt_first_final",
            );
          }
          // confidence 는 partial 단계라 신뢰 불가 → null. downstream 은 null 을 "high" 로 처리.
          this.opts.emit.onSourceFinal(deltaText, null);
          this.lastFinalSeq += 1;
          // 전체-텍스트 기준으로 committedPrefix 갱신. 다음 partial 부터는 이 뒤만 delta 로 취급.
          this.committedPrefix = rawText;
          this.lastCommitMs = now;
        }
        return;
      }

      // ── isFinal=true : Google 이 endpoint 를 감지해 확정. ──
      // soft-final 로 이미 커밋한 부분이 있으면 잘라내고 delta 만 커밋.
      let finalDelta = rawText;
      if (this.committedPrefix && rawText.startsWith(this.committedPrefix)) {
        finalDelta = rawText.slice(this.committedPrefix.length).trim();
      }
      // utterance 경계 → 누적 상태 리셋.
      this.committedPrefix = "";
      this.lastCommitMs = Date.now();

      if (!finalDelta) {
        // 모든 텍스트가 이미 soft-final 로 커밋됨 — 중복 방지를 위해 생략.
        return;
      }

      if (!this.loggedFirstFinal) {
        this.loggedFirstFinal = true;
        this.opts.log.info(
          {
            session: this.opts.sessionId,
            first_text_preview: finalDelta.slice(0, 40),
            kind: "real",
          },
          "google_stt_first_final",
        );
      }
      const confidence = result.alternatives[0].confidence ?? null;
      this.opts.emit.onSourceFinal(finalDelta, confidence);
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
    /** interim 결과에 한해 제공. "이 추정이 바뀌지 않을 확률" (0.0~1.0). */
    stability?: number;
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
