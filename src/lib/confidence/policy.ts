/**
 * 신뢰도 산정 및 재질문 정책.
 * 게이트웨이와 클라 양쪽에서 사용.
 */

import type { ConfidenceLevel, QualityMode } from "@/types/session";

export interface ConfidenceInput {
  /** OpenAI Realtime logprobs 평균 (음수). 없으면 null */
  avg_logprob: number | null;
  /** 원문 text */
  source_text: string;
  /** 번역 text */
  translated_text: string;
}

export interface ConfidenceResult {
  score: number; // 0~1
  level: ConfidenceLevel;
  flags: Flag[];
  requires_review: boolean;
}

export type Flag =
  | "number"
  | "date"
  | "money"
  | "negation"
  | "medical"
  | "name";

const HIGH_THRESHOLD = 0.85;
const MEDIUM_THRESHOLD = 0.6;

// 한/영 수치, 날짜, 돈, 부정 표현 감지 기본 패턴.
// 주의: JS 의 `\b` 는 ASCII `[A-Za-z0-9_]` 기준 단어 경계라 한국어 문자(가-힣)에는
// 작동하지 않는다. 한글 패턴은 `\b` 대신 부정 룩어라운드로 음절 독립성을 보장한다.
const RE_NUMBER = /\b\d{1,3}(,\d{3})*(\.\d+)?\b|[일이삼사오육칠팔구십백천만억조]{2,}/;
const RE_DATE = /\d{4}년|\d{1,2}월|\d{1,2}일|\d{1,2}:\d{2}|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/i;
const RE_MONEY = /원|달러|엔|\$|￥|₩|USD|KRW|JPY|EUR|\b(won|dollar|euro)s?\b/i;
const RE_NEG = /(?<![가-힣])(안|못|없|아니)(?![가-힣])|\b(not|never|no|none|doesn't|don't|isn't|aren't)\b/;
const RE_MEDICAL = /통증|증상|혈압|약|처방|symptom|pain|dose|medication|diagnosis/i;
const RE_PROPER = /[A-Z][a-z]+ [A-Z][a-z]+|[가-힣]{2,}\s[가-힣]{2,}/;

export function detectFlags(text: string): Flag[] {
  const flags: Flag[] = [];
  if (RE_NUMBER.test(text)) flags.push("number");
  if (RE_DATE.test(text)) flags.push("date");
  if (RE_MONEY.test(text)) flags.push("money");
  if (RE_NEG.test(text)) flags.push("negation");
  if (RE_MEDICAL.test(text)) flags.push("medical");
  if (RE_PROPER.test(text)) flags.push("name");
  return flags;
}

export function computeConfidence(
  input: ConfidenceInput,
  qualityMode: QualityMode,
): ConfidenceResult {
  // logprob → score: logprob는 0(완벽)~-∞. -2.0 을 0으로 매핑.
  let score = 0.5;
  if (typeof input.avg_logprob === "number") {
    score = Math.max(0, Math.min(1, 1 + input.avg_logprob / 2));
  }

  // heat: 중요 플래그가 있으면 임계 올림(신중하게 판정)
  const flags = Array.from(
    new Set([
      ...detectFlags(input.source_text),
      ...detectFlags(input.translated_text),
    ]),
  );
  const heat = flags.length * 0.05;

  const adjusted = Math.max(0, score - heat);

  const level: ConfidenceLevel =
    adjusted >= HIGH_THRESHOLD
      ? "high"
      : adjusted >= MEDIUM_THRESHOLD
      ? "medium"
      : "low";

  // premium 모드는 중요 플래그가 있으면 review 강제
  const riskyFlags = flags.some((f) =>
    (["number", "date", "money", "negation", "medical"] as Flag[]).includes(f),
  );
  const requires_review =
    level === "low" ||
    (qualityMode === "premium" && riskyFlags && level !== "high");

  return { score: adjusted, level, flags, requires_review };
}
