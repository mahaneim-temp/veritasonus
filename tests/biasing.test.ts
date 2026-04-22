import { describe, it, expect } from "vitest";
import { buildInstructions } from "@/lib/session/biasing";

describe("biasing buildInstructions", () => {
  it("returns base when no assets", () => {
    const out = buildInstructions("BASE", []);
    expect(out.startsWith("BASE")).toBe(true);
  });

  it("respects glossary > script priority order", () => {
    const out = buildInstructions("BASE", [
      { asset_type: "script", extracted_text: "스크립트 본문" },
      { asset_type: "glossary", extracted_text: "term:용어" },
    ]);
    const idxGlossary = out.indexOf("용어집");
    const idxScript = out.indexOf("원고");
    expect(idxGlossary).toBeGreaterThanOrEqual(0);
    expect(idxScript).toBeGreaterThanOrEqual(0);
    expect(idxGlossary).toBeLessThan(idxScript);
  });

  it("truncates per-asset to ASSET_MAX_CHARS (≈3500)", () => {
    const huge = "x".repeat(20_000);
    const out = buildInstructions("BASE", [
      { asset_type: "script", extracted_text: huge },
    ]);
    // 본문은 3500자 미만으로 잘려야 한다 (헤더 포함 전체도 합리적 크기 내)
    expect(out.length).toBeLessThan(20_000);
    expect(out.length).toBeLessThan(5000);
  });

  it("respects total cap of TOTAL_MAX_CHARS (≈10000)", () => {
    const huge = "y".repeat(8000);
    const out = buildInstructions(
      "BASE",
      Array.from({ length: 10 }, () => ({
        asset_type: "script" as const,
        extracted_text: huge,
      })),
    );
    expect(out.length).toBeLessThanOrEqual(15_000);
  });

  it("skips assets with null/empty extracted_text", () => {
    const out = buildInstructions("BASE", [
      { asset_type: "script", extracted_text: null },
      { asset_type: "glossary", extracted_text: "" },
    ]);
    expect(out).not.toContain("원고");
    expect(out).not.toContain("용어집");
  });
});
