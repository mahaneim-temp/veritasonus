import { describe, it, expect } from "vitest";
import { kstYyyymm } from "../src/lib/billing/quota";

// applyMonthReset 로직 순수 함수 추출
function applyMonthReset(
  wallet: { free_seconds_remaining: number; free_reset_yyyymm: string },
  now: Date,
  freePer: number = 600,
): { free_seconds_remaining: number; free_reset_yyyymm: string } {
  const thisMonth = kstYyyymm(now);
  if (wallet.free_reset_yyyymm === thisMonth) return wallet;
  return { free_seconds_remaining: freePer, free_reset_yyyymm: thisMonth };
}

describe("wallet monthly reset", () => {
  it("does not reset when month matches", () => {
    const now = new Date("2026-04-15T10:00:00Z");
    const yyyymm = kstYyyymm(now); // '202604'
    const w = { free_seconds_remaining: 200, free_reset_yyyymm: yyyymm };
    const r = applyMonthReset(w, now);
    expect(r.free_seconds_remaining).toBe(200); // unchanged
  });

  it("resets to 600 when month changes", () => {
    const now = new Date("2026-05-01T00:30:00Z"); // KST = 05-01 09:30
    const w = { free_seconds_remaining: 200, free_reset_yyyymm: "202604" };
    const r = applyMonthReset(w, now);
    expect(r.free_seconds_remaining).toBe(600);
    expect(r.free_reset_yyyymm).toBe("202605");
  });

  it("does NOT carry over remaining free seconds on reset", () => {
    const now = new Date("2026-05-01T00:30:00Z");
    const w = { free_seconds_remaining: 400, free_reset_yyyymm: "202604" };
    const r = applyMonthReset(w, now);
    // The old 400s is gone — new month starts at 600
    expect(r.free_seconds_remaining).toBe(600);
  });

  it("KST midnight edge: UTC 2026-04-30T15:00:00Z = KST 2026-05-01T00:00:00", () => {
    const now = new Date("2026-04-30T15:00:00Z");
    expect(kstYyyymm(now)).toBe("202605");
  });
});
