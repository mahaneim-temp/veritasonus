/**
 * 자료 파싱(Asset parsing) — pdf / docx / pptx / txt 에서 일반 텍스트 추출.
 *
 * 사용처: parser-worker.ts 가 Supabase Storage 에서 파일을 내려받아 이 함수로 본문 추출 후
 * `session_assets.extracted_text` 에 저장 (상한 100KB).
 *
 * 원칙:
 *   - 이 파일의 주 export 인 `extractText` 는 순수 함수(Buffer → string). I/O 없음.
 *   - 지원 안 되는 포맷은 Error("unsupported_format") 을 던지고 워커가 parse_status='failed' 로 기록한다.
 *   - 각 라이브러리는 최소한의 얕은 래핑만. 추출 결과가 이상하면 정규화(공백 압축)만 수행.
 */

import JSZip from "jszip";
import mammoth from "mammoth";
import * as pdfParseNs from "pdf-parse";

// pdf-parse 의 ESM/CJS dual export 를 안전하게 resolve.
const pdfParse: (buf: Buffer) => Promise<{ text?: string }> =
  (pdfParseNs as unknown as {
    default?: (buf: Buffer) => Promise<{ text?: string }>;
  }).default ??
  (pdfParseNs as unknown as (buf: Buffer) => Promise<{ text?: string }>);

/** 파싱 후 extracted_text 저장 상한 (SSOT §7 biasing). */
export const EXTRACT_MAX_BYTES = 100 * 1024;

export type SupportedKind = "pdf" | "docx" | "pptx" | "txt";

export interface ExtractHint {
  mime?: string | null;
  extension?: string | null;
}

export class ParseError extends Error {
  readonly code:
    | "unsupported_format"
    | "corrupt_file"
    | "empty_result";
  constructor(code: ParseError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "ParseError";
  }
}

/** mime/extension 에서 파서 선택. 둘 다 알려져 있지 않으면 unsupported. */
export function detectKind(hint: ExtractHint): SupportedKind | null {
  const mime = hint.mime?.toLowerCase() ?? "";
  const ext = (hint.extension ?? "").toLowerCase().replace(/^\./, "");

  if (mime.includes("pdf") || ext === "pdf") return "pdf";
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  )
    return "docx";
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    ext === "pptx"
  )
    return "pptx";
  if (mime.startsWith("text/") || ext === "txt" || ext === "md") return "txt";
  return null;
}

/** 메인 진입점. */
export async function extractText(
  buffer: Buffer,
  hint: ExtractHint,
): Promise<string> {
  const kind = detectKind(hint);
  if (!kind) {
    throw new ParseError(
      "unsupported_format",
      `지원하지 않는 포맷입니다 (mime=${hint.mime ?? "?"}, ext=${hint.extension ?? "?"})`,
    );
  }
  let raw: string;
  try {
    switch (kind) {
      case "pdf":
        raw = await extractPdf(buffer);
        break;
      case "docx":
        raw = await extractDocx(buffer);
        break;
      case "pptx":
        raw = await extractPptx(buffer);
        break;
      case "txt":
        raw = extractTxt(buffer);
        break;
    }
  } catch (e) {
    if (e instanceof ParseError) throw e;
    throw new ParseError("corrupt_file", `파싱 실패: ${String(e)}`);
  }

  const normalized = normalizeWhitespace(raw);
  if (!normalized) {
    throw new ParseError("empty_result", "추출된 텍스트가 비어 있습니다.");
  }
  return clampBytes(normalized, EXTRACT_MAX_BYTES);
}

// ── 포맷별 추출기 ────────────────────────────────────────────

async function extractPdf(buffer: Buffer): Promise<string> {
  const out = await pdfParse(buffer);
  return out.text ?? "";
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const out = await mammoth.extractRawText({ buffer });
  return out.value ?? "";
}

async function extractPptx(buffer: Buffer): Promise<string> {
  // .pptx 는 OpenXML(ZIP). ppt/slides/slide*.xml 의 <a:t>...</a:t> 텍스트 런만 뽑는다.
  // 헤비한 pptx2html 대신 jszip + 정규식으로 경량 처리. 서식·애니메이션 정보는 버린다.
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort(compareSlidePath);
  if (slidePaths.length === 0) return "";

  const parts: string[] = [];
  for (const path of slidePaths) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("string");
    const texts = Array.from(xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)).map(
      (m) => decodeXmlEntities(m[1] ?? ""),
    );
    if (texts.length > 0) parts.push(texts.join(" "));
  }
  return parts.join("\n\n");
}

function extractTxt(buffer: Buffer): string {
  // BOM 제거 후 UTF-8 로 해석. BOM 없으면 그대로.
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return buffer.subarray(3).toString("utf8");
  }
  return buffer.toString("utf8");
}

// ── 유틸 ─────────────────────────────────────────────────────

function normalizeWhitespace(s: string): string {
  // 연속 공백/개행을 압축하되, 단락 구분(\n\n) 은 보존.
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clampBytes(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, "utf8");
  if (buf.length <= maxBytes) return s;
  // UTF-8 경계를 깨뜨리지 않도록 안전하게 줄임. continuation byte 는 0b10xxxxxx.
  let cut = maxBytes;
  while (cut > 0) {
    const b = buf[cut];
    if (b === undefined) break;
    if ((b & 0xc0) !== 0x80) break;
    cut -= 1;
  }
  return buf.subarray(0, cut).toString("utf8");
}

function compareSlidePath(a: string, b: string): number {
  // "slide2.xml" 이 "slide10.xml" 보다 앞서도록 숫자 정렬.
  const na = Number(/slide(\d+)\.xml$/.exec(a)?.[1] ?? 0);
  const nb = Number(/slide(\d+)\.xml$/.exec(b)?.[1] ?? 0);
  return na - nb;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
