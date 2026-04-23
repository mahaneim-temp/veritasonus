import { describe, it, expect } from "vitest";
import { CREDIT_PACKS, packById } from "../src/lib/billing/plans";

describe("CREDIT_PACKS structure", () => {
  it("has exactly 4 packs", () => {
    expect(CREDIT_PACKS).toHaveLength(4);
  });

  it("each pack totalSeconds = seconds + bonusSeconds", () => {
    for (const pack of CREDIT_PACKS) {
      expect(pack.totalSeconds).toBe(pack.seconds + pack.bonusSeconds);
    }
  });

  it("priceKrw matches spec values", () => {
    const prices = CREDIT_PACKS.map((p) => p.priceKrw);
    expect(prices).toEqual([10_000, 30_000, 50_000, 100_000]);
  });

  it("only credit_30k is highlighted", () => {
    const highlighted = CREDIT_PACKS.filter((p) => p.highlight);
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]!.id).toBe("credit_30k");
  });

  it("packById returns correct pack", () => {
    expect(packById("credit_10k")!.priceKrw).toBe(10_000);
    expect(packById("credit_100k")!.totalSeconds).toBe(900 * 60);
    expect(packById("nonexistent")).toBeUndefined();
  });
});
