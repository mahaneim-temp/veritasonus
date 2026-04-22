import { describe, it, expect } from "vitest";
import {
  extractBiasPhrases,
  MAX_PHRASES,
  MAX_TOTAL_CHARS,
} from "../realtime-gateway/src/biasing";

describe("extractBiasPhrases", () => {
  it("returns empty for empty input", () => {
    expect(extractBiasPhrases([])).toEqual([]);
    expect(extractBiasPhrases([""])).toEqual([]);
  });

  it("tokenizes on whitespace and common punctuation", () => {
    const out = extractBiasPhrases([
      "Acme Corp, Dr. Kim, version 1.0; Foobar!",
    ]);
    // 3자 미만 토큰("Dr")도 쳐낸다, 순수 숫자 "1.0" 도 제외.
    expect(out).toContain("Acme");
    expect(out).toContain("Corp");
    expect(out).toContain("Kim");
    expect(out).toContain("version");
    expect(out).toContain("Foobar");
    expect(out).not.toContain("1.0");
  });

  it("dedupes case-insensitively but preserves first-seen casing", () => {
    const out = extractBiasPhrases(["Acme acme ACME"]);
    expect(out).toEqual(["Acme"]);
  });

  it("filters out tokens under 3 chars", () => {
    const out = extractBiasPhrases(["AI is a big win"]);
    expect(out).not.toContain("AI");
    expect(out).not.toContain("is");
    expect(out).not.toContain("a");
    expect(out).toContain("big");
    expect(out).toContain("win");
  });

  it("filters out tokens over 40 chars", () => {
    const long = "a".repeat(50);
    const out = extractBiasPhrases([`${long} ShortEnough`]);
    expect(out).not.toContain(long);
    expect(out).toContain("ShortEnough");
  });

  it("filters pure numeric/date tokens", () => {
    const out = extractBiasPhrases(["2024 4,500 10-20 3.14 realword"]);
    expect(out).toEqual(["realword"]);
  });

  it("caps phrase count at MAX_PHRASES", () => {
    const tokens = Array.from({ length: 200 }, (_, i) => `Phrase${i}`).join(" ");
    const out = extractBiasPhrases([tokens]);
    expect(out.length).toBe(MAX_PHRASES);
    expect(out[0]).toBe("Phrase0");
  });

  it("caps total chars at MAX_TOTAL_CHARS", () => {
    const token = "a".repeat(30);
    const many = Array.from({ length: 300 }, (_, i) => `${token}${i}`).join(
      " ",
    );
    const out = extractBiasPhrases([many]);
    const total = out.reduce((a, s) => a + s.length + 1, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_CHARS);
  });

  it("merges multiple texts (다수의 asset)", () => {
    const out = extractBiasPhrases(["Alpha Beta", "Gamma Delta"]);
    expect(out).toEqual(
      expect.arrayContaining(["Alpha", "Beta", "Gamma", "Delta"]),
    );
  });

  it("handles Korean tokens separated by spaces (3+ chars only)", () => {
    const out = extractBiasPhrases(["루시드인터프리트 팀장 김영희 서울시"]);
    // 3자 이상만 수용 — "팀장"(2자)은 제외. 이는 영어 불용어(is/at)를 같이 거르는 정책.
    expect(out).toEqual(
      expect.arrayContaining(["루시드인터프리트", "김영희", "서울시"]),
    );
    expect(out).not.toContain("팀장");
  });

  it("strips smart quotes and brackets", () => {
    const out = extractBiasPhrases([`"Hello" [world] (test)`]);
    expect(out).toEqual(
      expect.arrayContaining(["Hello", "world", "test"]),
    );
  });
});
