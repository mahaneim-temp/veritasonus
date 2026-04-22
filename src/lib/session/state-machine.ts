/**
 * 세션 상태기계 — 순수 함수.
 * SSOT §11.1 및 0_설계_패키지/07_상태기계.md 참조.
 *
 * transition() 는 side effect가 없다. effects 배열로 호출자에게 의도를 반환한다.
 */

import type { SessionState, SessionMode } from "@/types/session";

export type SessionEvent =
  | { type: "preflight_ok" }
  | { type: "preflight_fail"; reason: string }
  | { type: "prepared" }
  | { type: "start_quick" }
  | { type: "start" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "end"; reason?: "user" | "trial" | "network" | "error" }
  | { type: "ws_disconnected"; wasPaused: boolean }
  | { type: "ws_reconnected" }
  | { type: "reconnect_gave_up" }
  | { type: "request_reconstruct" }
  | { type: "reconstruct_done" }
  | { type: "reconstruct_failed" }
  | { type: "topic_locked" } // listener-specific
  | { type: "topic_timeout" }; // listener-specific

export interface Effect {
  type:
    | "ws_open"
    | "ws_close"
    | "ws_reconnect"
    | "schedule_reconstruct"
    | "show_warning"
    | "log";
  payload?: Record<string, unknown>;
}

export interface Context {
  mode: SessionMode;
  hasMicPermission: boolean;
  hasGatewayToken: boolean;
  trialRemainingS: number;
  utterancesCount: number;
  recordingEnabled: boolean;
  topicDiscoveryActive: boolean; // listener 모드에서만 true
  /** 재연결 중 "복구해야 할 원 상태". live 에서 끊겼으면 live, paused 에서 끊겼으면 paused. */
  reconnectReturnTo: "live" | "paused" | null;
}

export interface TransitionResult {
  state: SessionState;
  effects: Effect[];
}

/** Listener 모드에서 LIVE 직전 topic discovery 여부 */
export function needsTopicDiscovery(ctx: Context): boolean {
  return (
    ctx.mode === "listener_live" || ctx.mode === "listener_live_recorded"
  );
}

function canGoLive(ctx: Context): string | null {
  if (!ctx.hasMicPermission) return "mic_permission_required";
  if (!ctx.hasGatewayToken) return "gateway_token_required";
  if (ctx.trialRemainingS <= 0) return "trial_expired";
  return null;
}

/** 순수 전이 함수. 유효하지 않은 입력은 상태를 그대로 두고 effect=log 반환. */
export function transition(
  state: SessionState,
  event: SessionEvent,
  ctx: Context,
): TransitionResult {
  const noop = (msg: string): TransitionResult => ({
    state,
    effects: [{ type: "log", payload: { msg, event: event.type, state } }],
  });

  switch (state) {
    case "idle":
      if (event.type === "preflight_ok") return { state: "preflight", effects: [] };
      return noop("invalid_in_idle");

    case "preflight":
      if (event.type === "preflight_fail")
        return { state: "idle", effects: [{ type: "show_warning", payload: { reason: event.reason } }] };
      if (event.type === "prepared") return { state: "prepared", effects: [] };
      if (event.type === "start_quick") {
        const block = canGoLive(ctx);
        if (block)
          return {
            state,
            effects: [{ type: "show_warning", payload: { reason: block } }],
          };
        if (needsTopicDiscovery(ctx)) {
          // TOPIC_DISCOVERY 는 별도 상태로 두지 않고 prepared → (topic) → live 로 처리하지 않는다.
          // 빠른 시작은 listener 모드일 때도 바로 live로 가되, 화면에서 topic_guess 표시만 진행.
        }
        return {
          state: "live",
          effects: [{ type: "ws_open" }],
        };
      }
      return noop("invalid_in_preflight");

    case "prepared":
      if (event.type === "start") {
        const block = canGoLive(ctx);
        if (block)
          return {
            state,
            effects: [{ type: "show_warning", payload: { reason: block } }],
          };
        return { state: "live", effects: [{ type: "ws_open" }] };
      }
      return noop("invalid_in_prepared");

    case "live":
      if (event.type === "pause") return { state: "paused", effects: [] };
      if (event.type === "ws_disconnected") {
        return {
          state: "reconnecting",
          effects: [
            { type: "ws_reconnect", payload: { returnTo: "live" } },
          ],
        };
      }
      if (event.type === "end")
        return {
          state: "ended",
          effects: [{ type: "ws_close", payload: { reason: event.reason } }],
        };
      return noop("invalid_in_live");

    case "paused":
      if (event.type === "resume") return { state: "live", effects: [] };
      if (event.type === "ws_disconnected") {
        return {
          state: "reconnecting",
          effects: [
            { type: "ws_reconnect", payload: { returnTo: "paused" } },
          ],
        };
      }
      if (event.type === "end")
        return {
          state: "ended",
          effects: [{ type: "ws_close", payload: { reason: event.reason } }],
        };
      return noop("invalid_in_paused");

    case "reconnecting":
      if (event.type === "ws_reconnected") {
        const back = ctx.reconnectReturnTo ?? "live";
        return { state: back, effects: [] };
      }
      if (event.type === "reconnect_gave_up") {
        return {
          state: "ended",
          effects: [
            { type: "show_warning", payload: { reason: "network_lost" } },
            { type: "ws_close", payload: { reason: "network" } },
          ],
        };
      }
      if (event.type === "end")
        return {
          state: "ended",
          effects: [{ type: "ws_close", payload: { reason: event.reason } }],
        };
      return noop("invalid_in_reconnecting");

    case "ended": {
      if (event.type === "request_reconstruct") {
        const ok =
          ctx.recordingEnabled || ctx.utterancesCount > 5;
        if (!ok)
          return {
            state,
            effects: [
              { type: "show_warning", payload: { reason: "not_enough_data" } },
            ],
          };
        return {
          state: "post_reconstructing",
          effects: [{ type: "schedule_reconstruct" }],
        };
      }
      return noop("invalid_in_ended");
    }

    case "post_reconstructing":
      if (event.type === "reconstruct_done") return { state: "completed", effects: [] };
      if (event.type === "reconstruct_failed")
        return {
          state: "ended",
          effects: [{ type: "show_warning", payload: { reason: "reconstruct_failed" } }],
        };
      return noop("invalid_in_post_reconstructing");

    case "completed":
      return noop("terminal");
  }
}

/** 초기 상태 */
export const INITIAL_STATE: SessionState = "idle";
