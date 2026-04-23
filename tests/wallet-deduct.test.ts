import { describe, it, expect } from "vitest";

// wallet 로직을 순수 함수로 테스트 (DB 의존성 없음).
// 실제 deductUsage 는 비동기 DB 호출이므로 핵심 로직만 순수 추출해 테스트.

function applyDeduction(
  wallet: { free: number; purchased: number; granted: number },
  delta: number,
): { free: number; purchased: number; granted: number } {
  let rem = Math.ceil(delta);
  let { free, purchased, granted } = wallet;

  if (free > 0) { const u = Math.min(free, rem); free -= u; rem -= u; }
  if (rem > 0 && purchased > 0) { const u = Math.min(purchased, rem); purchased -= u; rem -= u; }
  if (rem > 0 && granted > 0) { const u = Math.min(granted, rem); granted -= u; rem -= u; }

  return {
    free: Math.max(0, free),
    purchased: Math.max(0, purchased),
    granted: Math.max(0, granted),
  };
}

describe("wallet deduction priority: free → purchased → granted", () => {
  it("deducts from free first", () => {
    const r = applyDeduction({ free: 300, purchased: 600, granted: 0 }, 100);
    expect(r.free).toBe(200);
    expect(r.purchased).toBe(600);
  });

  it("spills into purchased when free exhausted", () => {
    const r = applyDeduction({ free: 50, purchased: 600, granted: 0 }, 200);
    expect(r.free).toBe(0);
    expect(r.purchased).toBe(450);
  });

  it("spills into granted last", () => {
    const r = applyDeduction({ free: 0, purchased: 0, granted: 300 }, 100);
    expect(r.granted).toBe(200);
  });

  it("does not go below 0 on over-usage", () => {
    const r = applyDeduction({ free: 10, purchased: 10, granted: 10 }, 1000);
    expect(r.free).toBe(0);
    expect(r.purchased).toBe(0);
    expect(r.granted).toBe(0);
  });

  it("no-op for 0 delta", () => {
    const r = applyDeduction({ free: 300, purchased: 600, granted: 0 }, 0);
    expect(r.free).toBe(300);
    expect(r.purchased).toBe(600);
  });
});
