import { describe, it, expect } from "vitest";
import {
  evaluateQuota,
  kstYyyymm,
} from "@/lib/billing/quota";
import {
  quotaSecondsForRole,
  PLAN_QUOTA_SECONDS,
  QUOTA_WARN_RATIO,
  QUOTA_LIMIT_RATIO,
} from "@/lib/billing/plans";

describe("kstYyyymm", () => {
  it("returns YYYYMM string in KST (UTC+9)", () => {
    // UTC 2026-04-21 20:00:00 = KST 2026-04-22 05:00:00 → '202604'
    expect(kstYyyymm(new Date("2026-04-21T20:00:00Z"))).toBe("202604");
  });

  it("rolls over at KST midnight, not UTC midnight", () => {
    // UTC 2026-04-30 16:00:00 = KST 2026-05-01 01:00:00 → '202605'
    expect(kstYyyymm(new Date("2026-04-30T16:00:00Z"))).toBe("202605");
  });

  it("pads single-digit month", () => {
    expect(kstYyyymm(new Date("2026-01-15T00:00:00Z"))).toBe("202601");
    expect(kstYyyymm(new Date("2026-09-15T00:00:00Z"))).toBe("202609");
  });
});

describe("quotaSecondsForRole", () => {
  // v2: 충전제 지갑 모델로 전환 후 quotaSecondsForRole 는 admin 만 구분.
  // paid/member 는 wallet.getEffectiveRemaining() 으로 판단 — 여기서는 null 반환.
  it("admin / superadmin are unlimited (null)", () => {
    expect(quotaSecondsForRole("admin")).toBeNull();
    expect(quotaSecondsForRole("superadmin")).toBeNull();
  });

  it("paid / member / guest / null all return null (wallet-based policy)", () => {
    expect(quotaSecondsForRole("paid")).toBeNull();
    expect(quotaSecondsForRole("member")).toBeNull();
    expect(quotaSecondsForRole("guest")).toBeNull();
    expect(quotaSecondsForRole(null)).toBeNull();
    expect(quotaSecondsForRole(undefined)).toBeNull();
  });
});

describe("evaluateQuota", () => {
  const LIMIT = 72_000; // 20 시간

  it("null/0 limit → always ok", () => {
    const r = evaluateQuota(100_000, null);
    expect(r.status).toBe("ok");
    expect(r.remainingSeconds).toBeNull();
    expect(r.ratio).toBeNull();
  });

  it("under 80% → ok", () => {
    const r = evaluateQuota(LIMIT * 0.5, LIMIT);
    expect(r.status).toBe("ok");
    expect(r.remainingSeconds).toBe(LIMIT * 0.5);
  });

  it("exactly 80% → warn_80", () => {
    const r = evaluateQuota(LIMIT * QUOTA_WARN_RATIO, LIMIT);
    expect(r.status).toBe("warn_80");
  });

  it("between 80% and 100% → warn_80", () => {
    const r = evaluateQuota(LIMIT * 0.95, LIMIT);
    expect(r.status).toBe("warn_80");
  });

  it("exactly 100% → limit_reached", () => {
    const r = evaluateQuota(LIMIT * QUOTA_LIMIT_RATIO, LIMIT);
    expect(r.status).toBe("limit_reached");
    expect(r.remainingSeconds).toBe(0);
  });

  it("over 100% (overshoot) → limit_reached with remaining=0", () => {
    const r = evaluateQuota(LIMIT + 1000, LIMIT);
    expect(r.status).toBe("limit_reached");
    expect(r.remainingSeconds).toBe(0);
  });

  it("ratio is reported for UI progress bars", () => {
    const r = evaluateQuota(LIMIT * 0.5, LIMIT);
    expect(r.ratio).toBeCloseTo(0.5, 5);
  });
});
