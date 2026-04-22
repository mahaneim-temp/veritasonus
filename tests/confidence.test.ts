import { describe, it, expect } from "vitest";
import {
  computeConfidence,
  detectFlags,
} from "@/lib/confidence/policy";

describe("confidence policy", () => {
  it("flags numbers, money, dates", () => {
    const f1 = detectFlags("총 1,250 달러를 5월 3일에 송금");
    expect(f1).toContain("number");
    expect(f1).toContain("money");
    expect(f1).toContain("date");
  });

  it("flags negation", () => {
    expect(detectFlags("그 약은 안 먹어요")).toContain("negation");
    expect(detectFlags("I do not agree")).toContain("negation");
  });

  it("high logprob → high level when no risky flags", () => {
    const r = computeConfidence(
      {
        avg_logprob: -0.1,
        source_text: "안녕하세요",
        translated_text: "Hello",
      },
      "standard",
    );
    expect(r.level).toBe("high");
    expect(r.requires_review).toBe(false);
  });

  it("low logprob → low level and requires review", () => {
    const r = computeConfidence(
      {
        avg_logprob: -1.5,
        source_text: "잘 안 들렸어요",
        translated_text: "I couldn't hear well",
      },
      "standard",
    );
    expect(r.level).toBe("low");
    expect(r.requires_review).toBe(true);
  });

  it("premium mode forces review on risky flags even at medium", () => {
    const r = computeConfidence(
      {
        avg_logprob: -0.6, // ≈ 0.7 score → 0.7 - heat
        source_text: "총 150만원을 송금",
        translated_text: "Wire 1.5M won",
      },
      "premium",
    );
    expect(r.level === "medium" || r.level === "low").toBe(true);
    expect(r.requires_review).toBe(true);
  });

  it("missing logprob defaults to neutral score", () => {
    const r = computeConfidence(
      {
        avg_logprob: null,
        source_text: "test",
        translated_text: "test",
      },
      "standard",
    );
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });
});
