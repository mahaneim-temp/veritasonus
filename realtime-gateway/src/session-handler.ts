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

interface SessionCtx {
  claims: RealtimeClaims;
  provider: ProviderHandle | null;
  utteranceSeq: number;
  lastSourceSeq: number;
  trialTimer: NodeJS.Timeout | null;
  audioInFlight: boolean;
  liveStartedAtMs: number | null;
  usageFinalized: boolean;
  /** 가장 최근의 원문 (assist 컨텍스트용). */
  lastSourceText: string;
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
          audioInFlight: false,
          liveStartedAtMs: Date.now(),
          usageFinalized: false,
          lastSourceText: "",
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
      ctx.audioInFlight = true;
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

  const handle = await provider.start({
    sessionId: ctx.claims.session_id,
    sourceLang: source,
    targetLang: target,
    log,
    emit: {
      onSourceFinal: (text, confidence) => {
        ctx.utteranceSeq += 1;
        ctx.lastSourceSeq = ctx.utteranceSeq;
        ctx.lastSourceText = text;
        void writeUtterance({
          session_id: ctx.claims.session_id,
          seq: ctx.utteranceSeq,
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
          seq: ctx.utteranceSeq,
          text,
          confidence_score: confidence ?? 0,
        });
      },
      onTranslationFinal: (text) => {
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
      emitRaw: emitToClient,
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
}

function startTrialTimer(
  ctx: SessionCtx,
  client: WSClient,
  log: PinoLogger,
): void {
  if (ctx.claims.owner_type !== "guest") return;
  ctx.trialTimer = setInterval(async () => {
    if (!ctx.audioInFlight) return;
    ctx.audioInFlight = false;
    const left = await decrement(ctx.claims.sub, TRIAL_TICK_DECREMENT_S);
    try {
      client.send(
        JSON.stringify({
          type: "trial.tick",
          remaining_s: Number.isFinite(left) ? left : null,
        }),
      );
    } catch {
      // ignore
    }
    if (left <= 0) {
      log.info({ session: ctx.claims.session_id }, "trial_expired");
      try {
        client.close(4001, "trial_expired");
      } catch {
        // ignore
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
  if (!ctx.liveStartedAtMs) return;
  const elapsedSec = Math.max(
    0,
    Math.floor((Date.now() - ctx.liveStartedAtMs) / 1000),
  );
  if (elapsedSec === 0) return;
  try {
    await finalizeSessionUsage(
      ctx.claims.session_id,
      ctx.claims.owner_type === "member" ? "member" : "guest",
      ctx.claims.sub,
      elapsedSec,
    );
  } catch (e) {
    log.warn(
      { err: String(e), session: ctx.claims.session_id },
      "finalize_usage_failed",
    );
  }
}
