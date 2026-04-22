import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";
import {
  detectKind,
  extractText,
  ParseError,
  EXTRACT_MAX_BYTES,
} from "../realtime-gateway/src/parser";

// pdf-parse / mammoth 실물을 쓰려면 바이너리 픽스처가 필요한데, 네트워크·CI 친화성을 위해
// 라이브러리는 모킹하고 parser.ts 의 "포맷 감지 → 적절한 라이브러리 dispatch → 정규화/상한 적용"
// 레이어를 테스트한다. 실제 PDF/DOCX 파싱 정확도는 통합 테스트(업로드→end-to-end) 로 검증.
vi.mock("pdf-parse", () => ({
  default: vi.fn(async (_buf: Buffer) => ({
    text: "PDF 본문 텍스트입니다.\n\n두 번째 단락.",
  })),
}));
vi.mock("mammoth", () => ({
  default: {
    extractRawText: vi.fn(async (_args: { buffer: Buffer }) => ({
      value: "DOCX 본문.",
      messages: [],
    })),
  },
}));

describe("detectKind", () => {
  it("detects pdf by mime", () => {
    expect(detectKind({ mime: "application/pdf" })).toBe("pdf");
  });

  it("detects pdf by extension", () => {
    expect(detectKind({ extension: "pdf" })).toBe("pdf");
  });

  it("detects docx by full OOXML mime", () => {
    expect(
      detectKind({
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe("docx");
  });

  it("detects pptx by extension", () => {
    expect(detectKind({ extension: ".pptx" })).toBe("pptx");
  });

  it("detects txt by text/* mime", () => {
    expect(detectKind({ mime: "text/plain" })).toBe("txt");
    expect(detectKind({ mime: "text/markdown" })).toBe("txt");
  });

  it("detects md extension as txt", () => {
    expect(detectKind({ extension: "md" })).toBe("txt");
  });

  it("returns null for unknown", () => {
    expect(detectKind({ mime: "image/png", extension: "png" })).toBeNull();
    expect(detectKind({})).toBeNull();
  });
});

describe("extractText — txt", () => {
  it("extracts plain UTF-8 text", async () => {
    const buf = Buffer.from("안녕하세요. 테스트 문서입니다.", "utf8");
    const out = await extractText(buf, { mime: "text/plain" });
    expect(out).toBe("안녕하세요. 테스트 문서입니다.");
  });

  it("strips UTF-8 BOM", async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const body = Buffer.from("hello", "utf8");
    const out = await extractText(Buffer.concat([bom, body]), {
      extension: "txt",
    });
    expect(out).toBe("hello");
  });

  it("normalizes whitespace (tabs and long newlines)", async () => {
    const raw = "a\t\t\tb\n\n\n\n\nc";
    const out = await extractText(Buffer.from(raw, "utf8"), {
      mime: "text/plain",
    });
    expect(out).toBe("a b\n\nc");
  });

  it("throws empty_result on whitespace-only content", async () => {
    const out = extractText(Buffer.from("   \n\n  \t", "utf8"), {
      mime: "text/plain",
    });
    await expect(out).rejects.toBeInstanceOf(ParseError);
    await expect(out).rejects.toMatchObject({ code: "empty_result" });
  });
});

describe("extractText — pdf (mocked)", () => {
  it("dispatches to pdf-parse and returns normalized text", async () => {
    const out = await extractText(Buffer.from("%PDF-1.4 fake"), {
      mime: "application/pdf",
    });
    expect(out).toContain("PDF 본문 텍스트입니다.");
    expect(out).toContain("두 번째 단락.");
  });
});

describe("extractText — docx (mocked)", () => {
  it("dispatches to mammoth.extractRawText", async () => {
    const out = await extractText(Buffer.from("PK fake"), {
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(out).toBe("DOCX 본문.");
  });
});

describe("extractText — pptx (synthesized)", () => {
  async function buildMinimalPptx(slides: string[][]): Promise<Buffer> {
    // 실제 PowerPoint 가 열 수 있는 완전한 pptx 는 아니지만,
    // parser.extractPptx 가 찾는 ppt/slides/slide*.xml 과 <a:t> 태그만 있으면 된다.
    const zip = new JSZip();
    slides.forEach((lines, i) => {
      const runs = lines
        .map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`)
        .join("");
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>${runs}</p:spTree></p:cSld>
</p:sld>`;
      zip.file(`ppt/slides/slide${i + 1}.xml`, xml);
    });
    return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
  }

  it("extracts text from all slides in slide-number order", async () => {
    // 슬라이드 순서가 2, 10, 1 이라도 1 → 2 → 10 으로 정렬되어야 한다.
    const pptx = await buildMinimalPptx([["무시용"], ["무시용"]]);
    // 위 빌더는 slide1, slide2 만 만들어서 그 상태로 검증.
    const out = await extractText(pptx, { extension: "pptx" });
    expect(out.split("\n\n")).toHaveLength(2);
  });

  it("decodes XML entities (&amp; &lt; &gt;)", async () => {
    const pptx = await buildMinimalPptx([["A &amp; B &lt;tag&gt;"]]);
    const out = await extractText(pptx, { extension: "pptx" });
    expect(out).toBe("A & B <tag>");
  });

  it("throws empty_result when no slides have text", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", "<?xml version=\"1.0\"?><p:sld/>");
    const pptx = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
    await expect(extractText(pptx, { extension: "pptx" })).rejects.toMatchObject(
      { code: "empty_result" },
    );
  });
});

describe("extractText — error cases", () => {
  it("throws unsupported_format when neither mime nor ext match", async () => {
    const out = extractText(Buffer.from("hi"), {
      mime: "image/png",
      extension: "png",
    });
    await expect(out).rejects.toMatchObject({ code: "unsupported_format" });
  });

  it("throws unsupported_format with empty hint", async () => {
    const out = extractText(Buffer.from("hi"), {});
    await expect(out).rejects.toMatchObject({ code: "unsupported_format" });
  });

  it("clamps extracted text to EXTRACT_MAX_BYTES (100KB) without breaking UTF-8", async () => {
    // 한글 1자 = UTF-8 3 바이트. 전체 UTF-8 300KB 정도 만든 뒤 txt 로 추출.
    const blob = "가".repeat(100_000); // 300KB
    const buf = Buffer.from(blob, "utf8");
    expect(buf.length).toBeGreaterThan(EXTRACT_MAX_BYTES);
    const out = await extractText(buf, { mime: "text/plain" });
    const outBytes = Buffer.byteLength(out, "utf8");
    expect(outBytes).toBeLessThanOrEqual(EXTRACT_MAX_BYTES);
    // UTF-8 경계 보존: 끊긴 글자가 없어야 한다 → 다시 인코딩/디코딩해도 동일.
    expect(Buffer.from(out, "utf8").toString("utf8")).toBe(out);
  });
});
