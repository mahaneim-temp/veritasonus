/**
 * 브라우저 ↔ OpenAI Realtime 브릿지.
 *
 * 프로토콜:
 *   - 브라우저는 첫 메시지로 { type: "auth.hello", token } 을 보내야 한다.
 *   - 토큰 검증 성공 시 OpenAI Realtime API 와 별도 ws 연결을 연다.
 *   - 이후:
 *       바이너리 프레임(브라우저 → gateway) = PCM16 16k mono
 *           → OpenAI 'input_audio_buffer.append' 로 base64 인코딩 송신.
 *       JSON 프레임(브라우저 → gateway):
 *           { type: "session.update", instructions, voice, modalities, ... }
 *           { type: "control.commit" } / { type: "control.interrupt" }
 *           { type: "control.assist", intent }
 *       OpenAI → gateway → 브라우저: 그대로 forward 하되,
 *           transcript/response.audio.* 이벤트는 utterances 로도 persist.
 *
 * 게스트 트라이얼:
 *   - 첫 audio 프레임 수신 후 5초 단위 타이머가 작동.
 *   - peek 후 0이면 ws.close(4001, "trial_expired").
 */

import type { IncomingMessage } from "http";
import { WebSocket as WSClient, type RawData } from "ws";
import { v4 as uuidv4 } from "uuid";
import type { Logger as PinoLogger } from "pino";
import { logger } from "./logger.js";
import { ENV } from "./env.js";
import { verifyToken, type RealtimeClaims } from "./auth.js";
import { decrement } from "./trial.js";
import {
  finalizeSessionUsage,
  markSessionState,
  updateUtteranceTranslation,
  writeUtterance,
} from "./persist.js";
import {
  routeTranscriptEvent,
  type TranscriptState,
} from "./transcript-routing.js";

const TRIAL_TICK_MS = 5_000;
const TRIAL_TICK_DECREMENT_S = 5;

interface SessionCtx {
  claims: RealtimeClaims;
  upstream: WSClient | null;
  utteranceSeq: number;
  pendingTranscript: string;
  trialTimer: NodeJS.Timeout | null;
  audioInFlight: boolean;
  /** 세션이 live 로 전환된 시각(ms). usage 누적용. */
  liveStartedAtMs: number | null;
  /** usage 누적을 2번 호출하지 않기 위한 flag. */
  usageFinalized: boolean;
}

export async function handleConnection(
  ws: WSClient,
  _req: IncomingMessage,
): Promise<void> {
  const connId = uuidv4();
  let ctx: SessionCtx | null = null;

  const log = logger.child({ connId });

  // 30초 안에 auth.hello 가 안 오면 끊는다.
  const authDeadline = setTimeout(() => {
    if (!ctx) {
      try {
        ws.close(4002, "auth_timeout");
      } catch {
        // ignore
      }
    }
  }, 30_000);

  ws.on("message", async (data: RawData, isBinary: boolean) => {
    if (!ctx) {
      // 첫 메시지는 반드시 텍스트(auth.hello).
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
          upstream: null,
          utteranceSeq: 0,
          pendingTranscript: "",
          trialTimer: null,
          audioInFlight: false,
          liveStartedAtMs: Date.now(),
          usageFinalized: false,
        };
        log.info(
          { session: claims.session_id, owner: claims.owner_type },
          "auth_ok",
        );
        ws.send(JSON.stringify({ type: "auth.ok" }));
        await openUpstream(ws, ctx, log);
        await markSessionState(claims.session_id, "live");
      } catch (e) {
        log.warn({ err: String(e) }, "auth_failed");
        ws.close(4003, "auth_failed");
      }
      return;
    }

    // 인증된 이후
    if (isBinary) {
      // PCM16 → base64로 OpenAI에 append
      const buf = data as Buffer;
      ctx.audioInFlight = true;
      sendUpstream(ctx, {
        type: "input_audio_buffer.append",
        audio: buf.toString("base64"),
      });
      return;
    }

    // 클라이언트 컨트롤 메시지
    let msg: { type?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    switch (msg.type) {
      case "session.update":
        sendUpstream(ctx, {
          type: "session.update",
          session: msg["session"] ?? {},
        });
        break;
      case "heartbeat.ping": {
        // A-4: 클라 RTT 측정용. 받은 t 를 그대로 돌려준다.
        const t = typeof msg["t"] === "number" ? (msg["t"] as number) : Date.now();
        try {
          ws.send(JSON.stringify({ type: "heartbeat.pong", t }));
        } catch {
          // ignore
        }
        break;
      }
      case "auth.refresh": {
        // A-4: 만료 5분 전 클라가 재발급된 JWT 를 보내면 재검증 후 OK.
        const token = typeof msg["token"] === "string" ? (msg["token"] as string) : "";
        if (!token) {
          log.warn("auth_refresh_missing_token");
          break;
        }
        try {
          const claims = await verifyToken(token);
          // 같은 세션인지 확인.
          if (claims.session_id !== ctx.claims.session_id) {
            log.warn(
              { expected: ctx.claims.session_id, got: claims.session_id },
              "auth_refresh_session_mismatch",
            );
            break;
          }
          ctx.claims = claims;
          ws.send(JSON.stringify({ type: "auth.refreshed" }));
          log.info({ session: claims.session_id }, "auth_refreshed");
        } catch (e) {
          log.warn({ err: String(e) }, "auth_refresh_failed");
          // 토큰 갱신 실패는 치명적. 연결을 끊어 클라 재연결 루틴에 위임.
          try {
            ws.close(4003, "auth_refresh_failed");
          } catch {
            // ignore
          }
        }
        break;
      }
      case "control.commit":
        sendUpstream(ctx, { type: "input_audio_buffer.commit" });
        sendUpstream(ctx, { type: "response.create" });
        break;
      case "control.interrupt":
        sendUpstream(ctx, { type: "response.cancel" });
        break;
      case "control.assist": {
        // Assist mode: 사용자가 말하는 동안 LLM이 보조 문장 제안을 만든다.
        sendUpstream(ctx, {
          type: "response.create",
          response: {
            modalities: ["text"],
            instructions: assistPromptFor(String(msg["intent"] ?? "assist")),
          },
        });
        break;
      }
      case "control.end":
        await finalizeUsageIfNeeded(ctx, log);
        await markSessionState(ctx.claims.session_id, "ended");
        ws.close(1000, "ended");
        break;
      default:
        // unknown — 무시
        break;
    }
  });

  ws.on("close", async (code, reason) => {
    clearTimeout(authDeadline);
    if (ctx?.trialTimer) clearInterval(ctx.trialTimer);
    if (ctx?.upstream) {
      try {
        ctx.upstream.close();
      } catch {
        // ignore
      }
    }
    if (ctx) {
      log.info(
        { code, reason: reason.toString(), session: ctx.claims.session_id },
        "client_closed",
      );
      // F-1: 비정상 종료(재연결 등)에서도 usage 누적 누수되지 않게 한 번은 반드시 반영.
      await finalizeUsageIfNeeded(ctx, log);
    } else {
      log.info({ code, reason: reason.toString() }, "client_closed_pre_auth");
    }
  });

  ws.on("error", (e) => log.warn({ err: String(e) }, "client_ws_error"));
}

function sendUpstream(ctx: SessionCtx, obj: Record<string, unknown>) {
  if (!ctx.upstream || ctx.upstream.readyState !== WSClient.OPEN) return;
  try {
    ctx.upstream.send(JSON.stringify(obj));
  } catch (e) {
    logger.warn({ err: String(e) }, "upstream_send_failed");
  }
}

async function openUpstream(
  client: WSClient,
  ctx: SessionCtx,
  log: PinoLogger,
): Promise<void> {
  const upstream = new WSClient(
    `${ENV.OPENAI_REALTIME_URL}?model=${encodeURIComponent(ENV.OPENAI_REALTIME_MODEL)}`,
    {
      headers: {
        Authorization: `Bearer ${ENV.OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    },
  );
  ctx.upstream = upstream;

  upstream.on("open", () => {
    log.info("upstream_open");
    // 디폴트 세션 설정. 페이지에서 session.update로 세부 instructions를 덮어쓴다.
    sendUpstream(ctx, {
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: { type: "server_vad" },
      },
    });
    // 게스트 트라이얼 타이머 시작
    if (ctx.claims.owner_type === "guest") {
      ctx.trialTimer = setInterval(async () => {
        if (!ctx.audioInFlight) return; // 마이크가 꺼져있으면 차감 안 함
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
          try {
            client.close(4001, "trial_expired");
          } catch {
            // ignore
          }
        }
      }, TRIAL_TICK_MS);
    }
  });

  upstream.on("message", (data) => {
    // OpenAI는 JSON 텍스트와 binary 오디오 두 가지를 보낸다.
    if (Buffer.isBuffer(data)) {
      // 일부 모델 변형은 raw audio를 줄 수 있음 — 그대로 forward
      try {
        client.send(data);
      } catch {
        // ignore
      }
      return;
    }
    let evt: { type?: string; [k: string]: unknown };
    try {
      evt = JSON.parse(data.toString());
    } catch {
      return;
    }
    // 지나가는 transcript 이벤트는 utterance로 persist
    handleUpstreamEvent(ctx, evt).catch((e) =>
      log.warn({ err: String(e) }, "persist_failed"),
    );
    // 모든 이벤트는 클라이언트로 forward (필요한 것만 골라도 됨)
    try {
      client.send(JSON.stringify(evt));
    } catch {
      // ignore
    }
  });

  upstream.on("close", (code, reason) => {
    log.info({ code, reason: reason.toString() }, "upstream_close");
    try {
      client.close(1011, "upstream_closed");
    } catch {
      // ignore
    }
  });

  upstream.on("error", (e) => {
    log.error({ err: String(e) }, "upstream_error");
    try {
      client.close(1011, "upstream_error");
    } catch {
      // ignore
    }
  });
}

async function handleUpstreamEvent(
  ctx: SessionCtx,
  evt: { type?: string; [k: string]: unknown },
): Promise<void> {
  const state: TranscriptState = { utteranceSeq: ctx.utteranceSeq };
  const { nextState, action } = routeTranscriptEvent(state, evt);
  ctx.utteranceSeq = nextState.utteranceSeq;

  switch (action.kind) {
    case "write_source": {
      await writeUtterance({
        session_id: ctx.claims.session_id,
        seq: action.seq,
        speaker_label: "speaker",
        source_text: action.text,
        confidence_level: "high",
        confidence_score: null,
        requires_review: false,
        flags: [],
      });
      return;
    }
    case "update_translation": {
      await updateUtteranceTranslation(
        ctx.claims.session_id,
        action.seq,
        action.text,
      );
      return;
    }
    case "noop": {
      // 대부분의 이벤트는 여기로 — DB 액션이 필요 없음.
      // 단, translation_before_source 는 드문 엣지 케이스라 로깅으로 관측.
      if (action.reason === "translation_before_source") {
        logger.warn(
          { session: ctx.claims.session_id, evtType: evt.type },
          "translation_before_source",
        );
      }
      return;
    }
  }
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

function assistPromptFor(intent: string): string {
  switch (intent) {
    case "speak_self":
      return "사용자가 직접 말하려고 한다. 다음에 이어서 자연스럽게 말할 수 있는 한 문장을 모국어로 한 줄만 제안하라.";
    case "listen_only":
      return "사용자는 듣기만 하고 있다. 직전 발화의 핵심 의도와 행간(맥락/감정/뉘앙스)을 한 문장으로 짧게 요약하라.";
    default:
      return "통역 어시스트: 다음에 사용자가 말할 만한 적절한 표현 1개와, 직전 화자의 의도 한 줄을 제안하라. 형식: 'SAY: ...' 줄과 'INTENT: ...' 줄.";
  }
}
