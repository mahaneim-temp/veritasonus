import { describe, it, expect } from "vitest";
import {
  INITIAL_STATE,
  transition,
  type Context,
} from "@/lib/session/state-machine";

const baseCtx: Context = {
  mode: "interactive_interpretation",
  hasMicPermission: true,
  hasGatewayToken: true,
  trialRemainingS: 600,
  utterancesCount: 0,
  recordingEnabled: false,
  topicDiscoveryActive: false,
  reconnectReturnTo: null,
};

describe("session state-machine", () => {
  it("starts in idle and accepts preflight_ok", () => {
    expect(INITIAL_STATE).toBe("idle");
    const r = transition("idle", { type: "preflight_ok" }, baseCtx);
    expect(r.state).toBe("preflight");
  });

  it("blocks start_quick when mic permission missing", () => {
    const r = transition(
      "preflight",
      { type: "start_quick" },
      { ...baseCtx, hasMicPermission: false },
    );
    expect(r.state).toBe("preflight");
    expect(r.effects[0]?.type).toBe("show_warning");
    expect((r.effects[0]?.payload as any).reason).toBe(
      "mic_permission_required",
    );
  });

  it("blocks start_quick when gateway token missing", () => {
    const r = transition(
      "preflight",
      { type: "start_quick" },
      { ...baseCtx, hasGatewayToken: false },
    );
    expect(r.state).toBe("preflight");
    expect((r.effects[0]?.payload as any).reason).toBe("gateway_token_required");
  });

  it("blocks start_quick when trial expired", () => {
    const r = transition(
      "preflight",
      { type: "start_quick" },
      { ...baseCtx, trialRemainingS: 0 },
    );
    expect(r.state).toBe("preflight");
    expect((r.effects[0]?.payload as any).reason).toBe("trial_expired");
  });

  it("transitions preflight → live with ws_open effect", () => {
    const r = transition("preflight", { type: "start_quick" }, baseCtx);
    expect(r.state).toBe("live");
    expect(r.effects[0]?.type).toBe("ws_open");
  });

  it("pauses and resumes from live", () => {
    const r1 = transition("live", { type: "pause" }, baseCtx);
    expect(r1.state).toBe("paused");
    const r2 = transition("paused", { type: "resume" }, baseCtx);
    expect(r2.state).toBe("live");
  });

  it("ending live emits ws_close", () => {
    const r = transition(
      "live",
      { type: "end", reason: "user" },
      baseCtx,
    );
    expect(r.state).toBe("ended");
    expect(r.effects[0]?.type).toBe("ws_close");
  });

  it("rejects reconstruct when not enough data", () => {
    const r = transition(
      "ended",
      { type: "request_reconstruct" },
      { ...baseCtx, utterancesCount: 2 },
    );
    expect(r.state).toBe("ended");
    expect(r.effects[0]?.type).toBe("show_warning");
  });

  it("schedules reconstruct when recording enabled or many utterances", () => {
    const r = transition(
      "ended",
      { type: "request_reconstruct" },
      { ...baseCtx, recordingEnabled: true },
    );
    expect(r.state).toBe("post_reconstructing");
    expect(r.effects[0]?.type).toBe("schedule_reconstruct");
  });

  it("transitions post_reconstructing → completed on done", () => {
    const r = transition(
      "post_reconstructing",
      { type: "reconstruct_done" },
      baseCtx,
    );
    expect(r.state).toBe("completed");
  });

  it("invalid event in idle is a noop with log effect", () => {
    const r = transition("idle", { type: "pause" }, baseCtx);
    expect(r.state).toBe("idle");
    expect(r.effects[0]?.type).toBe("log");
  });

  // ── A-4 재연결 전이 ─────────────────────────────────────
  it("live + ws_disconnected → reconnecting with ws_reconnect effect", () => {
    const r = transition(
      "live",
      { type: "ws_disconnected", wasPaused: false },
      baseCtx,
    );
    expect(r.state).toBe("reconnecting");
    expect(r.effects[0]?.type).toBe("ws_reconnect");
    expect((r.effects[0]?.payload as any).returnTo).toBe("live");
  });

  it("paused + ws_disconnected → reconnecting returning to paused", () => {
    const r = transition(
      "paused",
      { type: "ws_disconnected", wasPaused: true },
      baseCtx,
    );
    expect(r.state).toBe("reconnecting");
    expect((r.effects[0]?.payload as any).returnTo).toBe("paused");
  });

  it("reconnecting + ws_reconnected → returns to prior state from ctx", () => {
    const r = transition(
      "reconnecting",
      { type: "ws_reconnected" },
      { ...baseCtx, reconnectReturnTo: "paused" },
    );
    expect(r.state).toBe("paused");
  });

  it("reconnecting + ws_reconnected defaults to live when ctx is null", () => {
    const r = transition(
      "reconnecting",
      { type: "ws_reconnected" },
      baseCtx,
    );
    expect(r.state).toBe("live");
  });

  it("reconnecting + reconnect_gave_up → ended with warning + ws_close", () => {
    const r = transition(
      "reconnecting",
      { type: "reconnect_gave_up" },
      baseCtx,
    );
    expect(r.state).toBe("ended");
    expect(r.effects.map((e) => e.type)).toEqual([
      "show_warning",
      "ws_close",
    ]);
    expect((r.effects[0]?.payload as any).reason).toBe("network_lost");
  });

  it("reconnecting + end (user) → ended cleanly", () => {
    const r = transition(
      "reconnecting",
      { type: "end", reason: "user" },
      baseCtx,
    );
    expect(r.state).toBe("ended");
    expect(r.effects[0]?.type).toBe("ws_close");
  });
});
