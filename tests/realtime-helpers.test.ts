import { describe, it, expect } from "vitest";
import {
  backoffDelayMs,
  shouldRetry,
  planNextAttempt,
  INITIAL_BACKOFF,
  resetBackoff,
} from "@/lib/realtime/backoff";
import {
  sample,
  INITIAL_WATCHDOG,
  DEFAULT_CONFIG,
  type RttWatchdogState,
} from "@/lib/realtime/rtt-watchdog";
import {
  REFRESH_LEAD_MS,
  needsImmediateRefresh,
  scheduleRefreshDelayMs,
  parseExpiresAt,
} from "@/lib/realtime/token-lifecycle";

// ── backoff ─────────────────────────────────────────────────

describe("backoff", () => {
  it("returns 1000 / 2000 / 4000 for attempts 1..3", () => {
    expect(backoffDelayMs(1)).toBe(1000);
    expect(backoffDelayMs(2)).toBe(2000);
    expect(backoffDelayMs(3)).toBe(4000);
  });

  it("returns null for out-of-range attempts", () => {
    expect(backoffDelayMs(0)).toBeNull();
    expect(backoffDelayMs(4)).toBeNull();
    expect(backoffDelayMs(-1)).toBeNull();
    expect(backoffDelayMs(Number.NaN)).toBeNull();
  });

  it("shouldRetry is true for 1..3 only", () => {
    expect(shouldRetry(1)).toBe(true);
    expect(shouldRetry(3)).toBe(true);
    expect(shouldRetry(4)).toBe(false);
  });

  it("planNextAttempt progresses through 3 tries then gives up", () => {
    let state = INITIAL_BACKOFF;
    const delays: (number | null)[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { delayMs, next } = planNextAttempt(state);
      delays.push(delayMs);
      state = next;
    }
    expect(delays).toEqual([1000, 2000, 4000, null]);
    expect(state.gaveUp).toBe(true);
    expect(state.attempt).toBe(4);
  });

  it("resetBackoff returns a fresh zero state", () => {
    const reset = resetBackoff();
    expect(reset).toEqual(INITIAL_BACKOFF);
    expect(reset.gaveUp).toBe(false);
    expect(reset.attempt).toBe(0);
  });
});

// ── rtt-watchdog ─────────────────────────────────────────────

describe("rtt-watchdog", () => {
  const T = DEFAULT_CONFIG.thresholdMs; // 600ms
  const SUSTAIN = DEFAULT_CONFIG.sustainedMs; // 30s

  it("reports ok for clean samples", () => {
    let state: RttWatchdogState = INITIAL_WATCHDOG;
    const r1 = sample(state, 0, 100);
    state = r1.next;
    const r2 = sample(state, 1000, 120);
    expect(r2.level).toBe("ok");
    expect(r2.medianMs).toBe(110);
  });

  it("flags degraded only after sustainedMs of bad median", () => {
    let state: RttWatchdogState = INITIAL_WATCHDOG;
    // 0s ~ 29s, high RTT sustained for 29 seconds
    for (let t = 0; t <= 29_000; t += 1000) {
      state = sample(state, t, T + 100).next;
    }
    const justBefore = sample(state, 29_500, T + 100);
    expect(justBefore.level).toBe("ok"); // 29.5s sustained < 30s

    const atThirty = sample(state, 30_000, T + 100);
    expect(atThirty.level).toBe("degraded");
  });

  it("resets badSince when enough good samples drop the median", () => {
    let state: RttWatchdogState = INITIAL_WATCHDOG;
    // Start bad
    state = sample(state, 0, T + 100).next;
    state = sample(state, 1000, T + 100).next;
    // Bring in several good samples until median drops.
    state = sample(state, 2000, 50).next;
    state = sample(state, 3000, 50).next;
    const result = sample(state, 4000, 50);
    // Window now: [T+100, T+100, 50, 50, 50]. sorted: [50,50,50,T+100,T+100]. median=50.
    expect(result.medianMs).toBe(50);
    expect(result.level).toBe("ok");
    expect(result.next.badSinceMs).toBeNull();
  });

  it("evicts samples older than windowMs", () => {
    let state: RttWatchdogState = INITIAL_WATCHDOG;
    state = sample(state, 0, 100).next;
    state = sample(state, 30_000, 200).next;
    state = sample(state, 70_000, 300).next; // older 0ms sample now outside 60s window
    expect(state.samples.length).toBe(2);
    expect(state.samples.every((s) => s.atMs >= 10_000)).toBe(true);
  });

  it("computes median correctly for even-length windows", () => {
    let state: RttWatchdogState = INITIAL_WATCHDOG;
    const vals = [100, 200, 300, 400];
    vals.forEach((v, i) => {
      state = sample(state, i * 1000, v).next;
    });
    const last = sample(state, 5000, 500);
    // values in window: [100,200,300,400,500], median 300
    expect(last.medianMs).toBe(300);
  });
});

// ── token-lifecycle ─────────────────────────────────────────

describe("token-lifecycle", () => {
  it("needsImmediateRefresh true when expiry within lead", () => {
    const now = new Date("2026-04-22T10:00:00Z");
    const soon = new Date(now.getTime() + 4 * 60 * 1000); // 4min
    expect(needsImmediateRefresh(soon, now)).toBe(true);
  });

  it("needsImmediateRefresh false when plenty of time left", () => {
    const now = new Date("2026-04-22T10:00:00Z");
    const later = new Date(now.getTime() + 15 * 60 * 1000); // 15min
    expect(needsImmediateRefresh(later, now)).toBe(false);
  });

  it("scheduleRefreshDelayMs computes (ttl - lead)", () => {
    const now = new Date("2026-04-22T10:00:00Z");
    const in15 = new Date(now.getTime() + 15 * 60 * 1000);
    expect(scheduleRefreshDelayMs(in15, now)).toBe(
      15 * 60 * 1000 - REFRESH_LEAD_MS,
    );
  });

  it("scheduleRefreshDelayMs clamps to 0 when already in lead window", () => {
    const now = new Date("2026-04-22T10:00:00Z");
    const in4 = new Date(now.getTime() + 4 * 60 * 1000);
    expect(scheduleRefreshDelayMs(in4, now)).toBe(0);
  });

  it("scheduleRefreshDelayMs returns 0 when already expired", () => {
    const now = new Date("2026-04-22T10:00:00Z");
    const past = new Date(now.getTime() - 10_000);
    expect(scheduleRefreshDelayMs(past, now)).toBe(0);
  });

  it("parseExpiresAt accepts ISO string", () => {
    const d = parseExpiresAt("2026-04-22T10:00:00Z");
    expect(d).not.toBeNull();
    expect(d?.getUTCHours()).toBe(10);
  });

  it("parseExpiresAt returns null for garbage", () => {
    expect(parseExpiresAt("not a date")).toBeNull();
    expect(parseExpiresAt("")).toBeNull();
  });
});
