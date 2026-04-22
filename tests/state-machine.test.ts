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
});
