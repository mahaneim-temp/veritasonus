/**
 * 브라우저 ↔ Provider 브릿지 (provider-agnostic).
 *
 * 기존 `openai-bridge.ts` 의 공통 로직(auth, trial, heartbeat, usage, persist)을
 * Provider 추상화 위로 끌어올려 재작성.
 *
 * Provider 는 ENV.REALTIME_PROVIDER 로 선택 (openai | google).
 *
 * 클라이언트 프로토콜은 기존과 호환:
 *   - auth.hello, auth.refresh
 *   - heartbeat.ping / pong
 *   - control.commit / interrupt / assist / end
 *   - 바이너리 PCM16 오디오 프레임
 *
 * 서버 → 클라 이벤트:
 *   - auth.ok / auth.refreshed
 *   - trial.tick
 *   - heartbeat.pong
 *   - speech_final { seq, text, confidence_score }
 *   - translation_final { seq, text, confidence_level, confidence_score, flags }
 *   - assist_text { text }
 *   - error { code, message, retriable }
 *   - provider-specific partial / metadata 는 그대로 forward.
 */

import type { IncomingMessage } from "http";
import { WebSocket as WSClient, type RawData } from "ws";
import { v4 as uuidv4 } from "uuid";
import type { Logger as PinoLogger } from "pino";
import { logger } from "./logger.js";
import { verifyToken, type RealtimeClaims } from "./auth.js";
import { decrement } from "./trial.js";
import { ENV } from "./env.js";
import {
  finalizeSessionUsage,
  markSessionState,
  updateUtteranceTranslation,
  writeUtterance,
} from "./persist.js";
import { selectProvider } from "./providers/index.js";
import type { ProviderHandle } from "./providers/types.js";

const TRIAL_TICK_MS = 5_000;
const TRIAL_TICK_DECREMENT_S = 5;

/**
 * 짧은 final 을 홀드할 최대 시간(ms). 이 창 내에 다음 final 이 오면 병합.
 * 너무 크면 실시간성 훼손, 너무 작으면 "네.", "예." 같은 조각 파편화.
 * 800ms 가 보통의 말 사이 쉼보다는 짧고 조각 응답 간격보다는 큰 경계값.
 */
const MERGE_WINDOW_MS = 800;
/** 이 글자 수 이하면 "짧은 final" 로 간주해 병합 대상이 된다. */
const MERGE_SHORT_CHAR_THRESHOLD = 6;

interface PendingShort {
  text: string;
  confidence: number | null;
  timer: NodeJS.Timeout;
}

interface SessionCtx {
  claims: RealtimeClaims;
  provider: ProviderHandle | null;
  utteranceSeq: number;
  lastSourceSeq: number;
  trialTimer: NodeJS.Timeout | null;
  /**
   * 이전 tick 이후 "말하고 있다" 는 신호(Google STT 의 speech_partial / speech_final) 가
   * 한 번이라도 들어왔는지. 단순한 오디오 프레임 수신이 아니라 STT 가 음성으로 판별한 구간만 true.
   * 트라이얼·과금 둘 다 이 기준으로 차감.
   */
  speechDetectedSinceLastTick: boolean;
  /** 과금·관측용: 이번 세션에서 음성이 감지된 누적 초수. tick 당 5초 단위. */
  speechActiveSeconds: number;
  liveStartedAtMs: number | null;
  usageFinalized: boolean;
  /** 가장 최근의 원문 (assist 컨텍스트용). */
  lastSourceText: string;
  /** 병합 버퍼. 짧은 final 이 들어오면 여기에 보관, 다음 final 과 merge 또는 timeout 시 단독 flush. */
  pendingShort: PendingShort | null;
  /** openProvider 가 주입. 세션 종료 직전 pending 짧은 조각을 단독 확정하는 훅. */
  flushPendingShort: () => void;
}

function flushPendingShortOnCtx(ctx: SessionCtx): void {
  try {
    ctx.flushPendingShort();
  } catch {
    // ignore
  }
}

// 로컬 dev 편의를 위해 import 해두되, 실제 언어는 sessions row 에서 읽어와야 정확.
// v1 은 env/기본값으로 간단히 처리 (ko↔en).
function langsFromClaims(_claims: RealtimeClaims): {
  source: string;
  target: string;
} {
  // 클레임에 담아주는 게 이상적이지만 현재 RealtimeClaims 에 없으므로 기본값.
  // Provider 선택은 세션 수준에서만 중요. 언어쌍은 sessions 테이블에 있는 값이 최종 기준.
  return { source: "ko", target: "en" };
}

export async function handleConnection(
  ws: WSClient,
  _req: IncomingMessage,
): Promise<void> {
  const connId = uuidv4();
  const log = logger.child({ connId });
  let ctx: SessionCtx | null = null;

  const authDeadline = setTimeout(() => {
    if (!ctx) {
      try {
        ws.close(4002, "auth_timeout");
      } catch {
        // ignore
      }
    }
  }, 30_000);

  const emitToClient = (obj: Record<string, unknown>) => {
    if (ws.readyState !== WSClient.OPEN) return;
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      // ignore
    }
  };

  ws.on("message", async (data: RawData, isBinary: boolean) => {
    if (!ctx) {
      if (isBinary) {
        log.warn("audio_before_auth");
        ws.close(4003, "auth_required");
        return;
      }
      try {
        const msg = JSON.parse(data.toString()) as {
          type?: string;
          token?: string;
        };
        if (msg.type !== "auth.hello" || !msg.token) {
          ws.close(4003, "expected_auth_hello");
          return;
        }
        const claims = await verifyToken(msg.token);
        clearTimeout(authDeadline);
        ctx = {
          claims,
          provider: null,
          utteranceSeq: 0,
          lastSourceSeq: 0,
          trialTimer: null,
          speechDetectedSinceLastTick: false,
          speechActiveSeconds: 0,
          liveStartedAtMs: Date.now(),
          usageFinalized: false,
          lastSourceText: "",
          pendingShort: null,
          flushPendingShort: () => {
            /* openProvider 가 덮어씀 */
          },
        };
        log.info(
          { session: claims.session_id, owner: claims.owner_type },
          "auth_ok",
        );
        emitToClient({ type: "auth.ok" });
        await openProvider(ctx, emitToClient, log);
        startTrialTimer(ctx, ws, log);
        await markSessionState(claims.session_id, "live");
      } catch (e) {
        log.warn({ err: String(e) }, "auth_failed");
        ws.close(4003, "auth_failed");
      }
      return;
    }

    // 인증된 이후.
    if (isBinary) {
      // 바이너리 수신 자체는 "마이크 켜짐" 일 뿐. "말한 시간" 은 STT 이벤트로 판별 (openProvider 참조).
      ctx.provider?.sendAudio(data as Buffer);
      return;
    }

    let msg: { type?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case "heartbeat.ping": {
        const t = typeof msg["t"] === "number" ? (msg["t"] as number) : Date.now();
        emitToClient({ type: "heartbeat.pong", t });
        break;
      }
      case "auth.refresh": {
        const token = typeof msg["token"] === "string" ? (msg["token"] as string) : "";
        if (!token) {
          log.warn("auth_refresh_missing_token");
          break;
        }
        try {
          const claims = await verifyToken(token);
          if (claims.session_id !== ctx.claims.session_id) {
            log.warn(
              { expected: ctx.claims.session_id, got: claims.session_id },
              "auth_refresh_session_mismatch",
            );
            break;
          }
          ctx.claims = claims;
          emitToClient({ type: "auth.refreshed" });
          log.info({ session: claims.session_id }, "auth_refreshed");
        } catch (e) {
          log.warn({ err: String(e) }, "auth_refresh_failed");
          try {
            ws.close(4003, "auth_refresh_failed");
          } catch {
            // ignore
          }
        }
        break;
      }
      case "control.commit":
        ctx.provider?.commit();
        break;
      case "control.interrupt":
        ctx.provider?.interrupt();
        break;
      case "control.assist":
        await ctx.provider?.assist(
          String(msg["intent"] ?? "assist"),
          ctx.lastSourceText,
        );
        break;
      case "control.end":
        flushPendingShortOnCtx(ctx);
        await finalizeUsageIfNeeded(ctx, log);
        await markSessionState(ctx.claims.session_id, "ended");
        try {
          await ctx.provider?.close();
        } catch {
          // ignore
        }
        ws.close(1000, "ended");
        break;
      default:
        break;
    }
  });

  ws.on("close", async (code, reason) => {
    clearTimeout(authDeadline);
    if (ctx?.trialTimer) clearInterval(ctx.trialTimer);
    if (ctx) flushPendingShortOnCtx(ctx);
    try {
      await ctx?.provider?.close();
    } catch {
      // ignore
    }
    if (ctx) {
      log.info(
        { code, reason: reason.toString(), session: ctx.claims.session_id },
        "client_closed",
      );
      await finalizeUsageIfNeeded(ctx, log);
    } else {
      log.info({ code, reason: reason.toString() }, "client_closed_pre_auth");
    }
  });

  ws.on("error", (e) => log.warn({ err: String(e) }, "client_ws_error"));
}

async function openProvider(
  ctx: SessionCtx,
  emitToClient: (obj: Record<string, unknown>) => void,
  log: PinoLogger,
): Promise<void> {
  const provider = selectProvider();
  log.info({ provider: provider.name }, "provider_selected");
  const { source, target } = langsFromClaims(ctx.claims);

  // 실제 확정된 최종 텍스트를 persist + emit + translate.
  // 병합 버퍼(pendingShort)를 경유한 최종 텍스트만 여기로 흘러든다.
  const commitFinal = (text: string, confidence: number | null) => {
    ctx.utteranceSeq += 1;
    const seq = ctx.utteranceSeq;
    ctx.lastSourceSeq = seq;
    ctx.lastSourceText = text;

    void writeUtterance({
      session_id: ctx.claims.session_id,
      seq,
      speaker_label: "speaker",
      source_text: text,
      confidence_level: "high",
      confidence_score: confidence ?? null,
      requires_review: false,
      flags: [],
    }).catch((e) =>
      log.warn({ err: String(e) }, "write_utterance_failed"),
    );
    emitToClient({
      type: "speech_final",
      seq,
      text,
      confidence_score: confidence ?? 0,
    });

    // 번역은 확정 직후 명시적 호출.
    // Google provider: HTTP 1회. OpenAI Realtime: translate()=no-op, onTranslationFinal 경로로 비동기 수신.
    const handleRef = ctx.provider;
    if (handleRef) {
      void handleRef
        .translate(text)
        .then((tr) => {
          if (!tr) return; // 빈 문자열이면 emit 생략 — 별도 경로(OpenAI) 가 나중에 emit 함.
          void updateUtteranceTranslation(
            ctx.claims.session_id,
            seq,
            tr,
          ).catch((e) =>
            log.warn({ err: String(e) }, "update_translation_failed"),
          );
          emitToClient({
            type: "translation_final",
            seq,
            text: tr,
            confidence_level: "high",
            confidence_score: 0.9,
            flags: [],
          });
        })
        .catch((e) =>
          log.warn({ err: String(e) }, "translate_failed_in_commit"),
        );
    }
  };

  const flushPendingShort = () => {
    const p = ctx.pendingShort;
    if (!p) return;
    clearTimeout(p.timer);
    ctx.pendingShort = null;
    commitFinal(p.text, p.confidence);
  };

  const handle = await provider.start({
    sessionId: ctx.claims.session_id,
    sourceLang: source,
    targetLang: target,
    log,
    emit: {
      onSourceFinal: (text, confidence) => {
        const body = text.trim();
        if (!body) return;

        // STT 가 음성을 확정해서 이벤트가 왔다는 것 = 이번 tick 창은 "말한 시간" 으로 카운트.
        ctx.speechDetectedSinceLastTick = true;

        // 1) 보류 중인 짧은 조각이 있으면 이번 final 과 합친다.
        const pending = ctx.pendingShort;
        if (pending) {
          clearTimeout(pending.timer);
          ctx.pendingShort = null;
          const merged = `${pending.text} ${body}`;
          const mergedConf =
            confidence != null && pending.confidence != null
              ? Math.min(confidence, pending.confidence)
              : (confidence ?? pending.confidence);
          commitFinal(merged, mergedConf);
          return;
        }

        // 2) 현재 final 이 짧으면 다음 것 기다리며 버퍼에 보관.
        if (body.length <= MERGE_SHORT_CHAR_THRESHOLD) {
          const timer = setTimeout(() => {
            // window 내에 이어지는 final 이 없었다 — 단독 확정.
            const p = ctx.pendingShort;
            if (!p) return;
            ctx.pendingShort = null;
            commitFinal(p.text, p.confidence);
          }, MERGE_WINDOW_MS);
          ctx.pendingShort = { text: body, confidence, timer };
          return;
        }

        // 3) 일반 경로.
        commitFinal(body, confidence);
      },
      onTranslationFinal: (text) => {
        // OpenAI Realtime 처럼 provider 가 별도 경로로 번역을 밀어넣는 경우에만 쓰임.
        // Google 의 경우 commitFinal 내부에서 직접 처리하므로 이쪽으로 안 들어온다.
        if (ctx.lastSourceSeq === 0) {
          log.warn({ text }, "translation_before_source");
          return;
        }
        const seq = ctx.lastSourceSeq;
        void updateUtteranceTranslation(
          ctx.claims.session_id,
          seq,
          text,
        ).catch((e) =>
          log.warn({ err: String(e) }, "update_translation_failed"),
        );
        emitToClient({
          type: "translation_final",
          seq,
          text,
          confidence_level: "high",
          confidence_score: 0.9,
          flags: [],
        });
      },
      onAssistText: (text) => emitToClient({ type: "assist_text", text }),
      emitRaw: (event) => {
        // speech_partial 도 "말하는 중" 신호 — STT interim 결과가 흐르고 있다는 뜻.
        if ((event as { type?: string }).type === "speech_partial") {
          ctx.speechDetectedSinceLastTick = true;
        }
        emitToClient(event);
      },
      onError: (code, message) => {
        log.warn({ code, message }, "provider_error");
        emitToClient({
          type: "error",
          code,
          message,
          retriable: true,
        });
      },
    },
  });

  ctx.provider = handle;
  ctx.flushPendingShort = flushPendingShort;
}

/**
 * 5초 tick. "이번 tick 창 안에 STT 가 말하는 중 신호를 줬는가?" 로만 차감 여부 판단.
 * - 게스트: Redis 트라이얼 카운터 decrement + 클라에 trial.tick 송출.
 * - 회원: `speechActiveSeconds` 누적만 수행 (finalizeSessionUsage 가 세션 종료 시 DB 반영).
 * 말 안 함 / pause / 대기 / 마이크 muted 는 speechDetectedSinceLastTick 이 false 라서 자연스럽게 skip.
 */
function startTrialTimer(
  ctx: SessionCtx,
  client: WSClient,
  log: PinoLogger,
): void {
  ctx.trialTimer = setInterval(async () => {
    if (!ctx.speechDetectedSinceLastTick) return;
    ctx.speechDetectedSinceLastTick = false;
    ctx.speechActiveSeconds += TRIAL_TICK_DECREMENT_S;

    if (ctx.claims.owner_type === "guest") {
      // UNLIMITED_TRIAL: 내부 테스트용. Redis 차감 skip, 차감 이벤트도 송출 안 함.
      // 프로덕션 NODE_ENV 에서는 env.ts 가 강제로 false 로 만든다.
      if (ENV.UNLIMITED_TRIAL) return;

      const left = await decrement(ctx.claims.sub, TRIAL_TICK_DECREMENT_S);
      // 클라이언트 ServerEvent 타입 계약을 따른다 (types/realtime.ts).
      try {
        client.send(
          JSON.stringify({
            type: "trial_time_remaining",
            remaining_s: Number.isFinite(left) ? left : 0,
          }),
        );
      } catch {
        // ignore
      }
      if (left <= 0) {
        log.info({ session: ctx.claims.session_id }, "trial_expired");
        try {
          client.send(JSON.stringify({ type: "trial_expired" }));
        } catch {
          // ignore
        }
        try {
          client.close(4001, "trial_expired");
        } catch {
          // ignore
        }
      }
    }
  }, TRIAL_TICK_MS);
}

async function finalizeUsageIfNeeded(
  ctx: SessionCtx,
  log: PinoLogger,
): Promise<void> {
  if (ctx.usageFinalized) return;
  ctx.usageFinalized = true;
  // wall-clock 이 아니라 "실제 음성이 감지된 누적 초수" 를 과금 기준으로 저장.
  // pause / 대기 / 무음 구간은 speechActiveSeconds 에 포함되지 않으므로 자연스럽게 제외.
  const activeSec = ctx.speechActiveSeconds;
  if (activeSec === 0) return;
  try {
    await finalizeSessionUsage(
      ctx.claims.session_id,
      ctx.claims.owner_type === "member" ? "member" : "guest",
      ctx.claims.sub,
      activeSec,
    );
  } catch (e) {
    log.warn(
      { err: String(e), session: ctx.claims.session_id },
      "finalize_usage_failed",
    );
  }
}
