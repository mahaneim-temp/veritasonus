import { describe, it, expect } from "vitest";

// creditPurchase carryover 로직 순수 함수 추출
function applyCreditPurchase(
  wallet: { free_seconds_remaining: number; purchased_seconds: number },
  baseSeconds: number,
  bonusSeconds: number,
): {
  free_seconds_remaining: number;
  purchased_seconds: number;
  carriedFreeSeconds: number;
} {
  const carry = wallet.free_seconds_remaining;
  return {
    free_seconds_remaining: 0,
    purchased_seconds:
      wallet.purchased_seconds + carry + baseSeconds + bonusSeconds,
    carriedFreeSeconds: carry,
  };
}

describe("creditPurchase carryover", () => {
  it("carries over remaining free seconds into purchased on buy", () => {
    const r = applyCreditPurchase(
      { free_seconds_remaining: 480, purchased_seconds: 0 },
      12000, // 200분
      1200,  // 20분 보너스
    );
    expect(r.free_seconds_remaining).toBe(0);
    expect(r.purchased_seconds).toBe(480 + 12000 + 1200);
    expect(r.carriedFreeSeconds).toBe(480);
  });

  it("carry is 0 when free already exhausted", () => {
    const r = applyCreditPurchase(
      { free_seconds_remaining: 0, purchased_seconds: 1000 },
      12000,
      1200,
    );
    expect(r.carriedFreeSeconds).toBe(0);
    expect(r.purchased_seconds).toBe(1000 + 12000 + 1200);
  });

  it("full free pack + no bonus", () => {
    const r = applyCreditPurchase(
      { free_seconds_remaining: 600, purchased_seconds: 0 },
      3600, // 60분 pack
      0,
    );
    expect(r.purchased_seconds).toBe(600 + 3600);
    expect(r.free_seconds_remaining).toBe(0);
  });
});
