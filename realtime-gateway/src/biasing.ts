/**
 * session_assets.extracted_text → Google STT speechContexts phrases.
 *
 * 파싱 워커가 이미 `extracted_text` 에 담아놓은 본문을 기반으로 고유명사·전문 용어
 * 후보를 뽑는다. 정밀한 NER 대신 "여백·문장부호로 토큰화 → 길이·빈도 필터" 의
 * 가벼운 휴리스틱. v1.1 에서 Gemini 로 추출 품질을 올릴 수 있지만 v1 은 이 정도로 충분.
 *
 * Google STT speechContexts 제약:
 *   - 한 요청 당 phrase 총합 텍스트 ≤ ~5000 bytes
 *   - phrase 개수가 많을수록 인식 시간·비용 영향
 *   - 한 phrase 는 짧을수록(1~5단어) 가중치가 잘 걸림
 */

export const MAX_PHRASES = 50;
export const MAX_TOTAL_CHARS = 3000;
const MIN_TOKEN_LEN = 3;
const MAX_TOKEN_LEN = 40;

/** 여러 asset 의 추출 텍스트를 합쳐 phrases 로 환원. */
export function extractBiasPhrases(texts: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  let totalChars = 0;

  for (const raw of texts) {
    if (!raw) continue;
    // 문장부호·개행을 공백으로 치환한 뒤 단일 공백 기준으로 토큰화.
    const normalized = raw
      .replace(/[\n\r\t]+/g, " ")
      .replace(/[.,;:!?()\[\]{}"'`<>|/\\\u2018\u2019\u201C\u201D]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) continue;
    const tokens = normalized.split(" ");
    for (const tok of tokens) {
      const t = tok.trim();
      if (t.length < MIN_TOKEN_LEN) continue;
      if (t.length > MAX_TOKEN_LEN) continue;
      // 순수 숫자·날짜·버전 표기 (예: "2024", "v1.0") 는 adaptation 가치 낮음.
      if (/^[\d.,-]+$/.test(t)) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(t);
      totalChars += t.length + 1;
      if (ordered.length >= MAX_PHRASES) return ordered;
      if (totalChars >= MAX_TOTAL_CHARS) return ordered;
    }
  }
  return ordered;
}
