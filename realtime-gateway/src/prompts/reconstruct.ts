/**
 * 사후 복원 프롬프트·스키마 (A-3).
 *
 * 이 파일은 LLM 호출의 "계약" 만 담는 순수 모듈:
 *   - 시스템 프롬프트 상수 (한국어 톤, 환각 금지 원칙)
 *   - 사용자 프롬프트 빌더 (세션 메타 + 전사를 주입)
 *   - Zod 검증 스키마 (서버 쪽 이중 검증)
 *   - OpenAI structured outputs 용 JSON Schema (모델 쪽 강제)
 *   - 128k 토큰 초과 시 앞·뒤 보존 요약 로직 (순수)
 *
 * I/O 는 포함하지 않는다. 호출 측(reconstruct.ts) 이 fetch / Supabase 를 다룬다.
 */

import { z } from "zod";

// ── 프롬프트 ────────────────────────────────────────────────

export const RECONSTRUCT_SYSTEM_PROMPT = `당신은 통역·회의 기록 보조 전문가입니다.
방금 마친 대화(회의·강의·통역 세션)의 전사를 받아서 4개 축으로 정리해 JSON으로 반환하세요.

원칙:
- 전사에 없는 내용은 만들지 마세요 (환각 금지).
- 확실하지 않은 항목은 빈 배열로 두거나 요약을 짧게 남깁니다.
- 한국어로 출력하되, 고유명사·전문용어·약어는 원문 그대로 보존합니다.
- 일방향 발화(강의·설교·뉴스 등)에는 "key_decisions"/"action_items"가 비어 있을 수 있습니다.
- 숫자·날짜·금액은 원문 그대로 인용하고, 가능하면 단위를 명시합니다 (예: "150,000원", "2026-05-03", "오전 10시").

각 축의 뜻:
- summary: 대화의 주제·흐름·핵심 결론을 담은 2~4 문장의 자연스러운 산문.
- key_decisions: 대화 중 명시적으로 합의되거나 결정된 사항. 각 항목은 1문장 (예: "매주 금요일 오후 2시에 정기 회의를 연다").
- action_items: 누가·무엇을·언제까지 하기로 했는지. 주체가 명시되지 않았으면 "[미지정]" 으로 표기.
- important_numbers: 금액·날짜·정량 수치 등 기록할 가치가 있는 숫자. {label, value} 쌍으로 (예: {label: "예산 한도", value: "3,000만원"}).`;

// ── 입력 타입 ────────────────────────────────────────────────

export interface SessionMeta {
  source_lang: string;
  target_lang: string;
  mode: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface UtteranceForPrompt {
  seq: number;
  speaker_label: string | null;
  source_text: string;
  translated_text: string | null;
}

export interface BuildResult {
  systemPrompt: string;
  userPrompt: string;
  /** 원본 발화 수 (truncation 전). */
  originalCount: number;
  /** 실제 프롬프트에 포함된 발화 수. */
  includedCount: number;
  /** 앞·뒤 보존 후 중간을 잘랐으면 true. */
  truncated: boolean;
}

// ── 빌더 ─────────────────────────────────────────────────────

/**
 * 사후 복원 프롬프트를 만든다.
 *
 * 대략적인 토큰 상한: `maxChars` (기본 240,000자 ≈ 60~80k 토큰) 초과 시
 * 앞·뒤 비율 보존 + 중간 생략 표시.
 */
export function buildReconstructPrompt(
  meta: SessionMeta,
  utterances: UtteranceForPrompt[],
  opts?: { maxChars?: number },
): BuildResult {
  const maxChars = opts?.maxChars ?? 240_000;

  const lines = utterances.map((u) => formatUtterance(u));
  const { kept, truncated } = clampLines(lines, maxChars);

  const transcript = kept.join("\n");
  const userPrompt = [
    "세션 정보:",
    `- 언어: ${meta.source_lang} → ${meta.target_lang}`,
    `- 모드: ${meta.mode}`,
    `- 시간: ${meta.started_at ?? "?"} ~ ${meta.ended_at ?? "?"}`,
    `- 총 발화 수: ${utterances.length}${truncated ? ` (프롬프트에는 ${countNonPlaceholder(kept)}개만 포함)` : ""}`,
    "",
    "전사 (각 줄은 [발화자] 원문 | 번역):",
    transcript,
    "",
    "위 전사를 4개 축으로 정리한 JSON 을 반환하세요.",
  ].join("\n");

  return {
    systemPrompt: RECONSTRUCT_SYSTEM_PROMPT,
    userPrompt,
    originalCount: utterances.length,
    includedCount: countNonPlaceholder(kept),
    truncated,
  };
}

function formatUtterance(u: UtteranceForPrompt): string {
  const speaker = u.speaker_label ?? "speaker";
  const src = u.source_text.trim();
  const tr = (u.translated_text ?? "").trim();
  return tr ? `[${speaker}] ${src} | ${tr}` : `[${speaker}] ${src}`;
}

function clampLines(
  lines: string[],
  maxChars: number,
): { kept: string[]; truncated: boolean } {
  const total = lines.reduce((a, l) => a + l.length + 1, 0);
  if (total <= maxChars) return { kept: lines, truncated: false };

  // 앞 30% + 뒤 30% 보존, 중간은 placeholder 1줄.
  const headBudget = Math.floor(maxChars * 0.45);
  const tailBudget = Math.floor(maxChars * 0.45);
  const head: string[] = [];
  let headChars = 0;
  for (const l of lines) {
    if (headChars + l.length + 1 > headBudget) break;
    head.push(l);
    headChars += l.length + 1;
  }
  const tail: string[] = [];
  let tailChars = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = lines[i]!;
    if (tailChars + l.length + 1 > tailBudget) break;
    tail.unshift(l);
    tailChars += l.length + 1;
  }
  const skipped = lines.length - head.length - tail.length;
  if (skipped <= 0) {
    return { kept: lines, truncated: false };
  }
  const placeholder = `(... 중간 ${skipped}개 발화 생략 ...)`;
  return { kept: [...head, placeholder, ...tail], truncated: true };
}

function countNonPlaceholder(lines: string[]): number {
  return lines.filter((l) => !l.startsWith("(... 중간")).length;
}

// ── Zod 검증 ─────────────────────────────────────────────────

export const ReconstructResultSchema = z.object({
  summary: z.string().min(1).max(2000),
  key_decisions: z.array(z.string().min(1).max(500)).max(20),
  action_items: z.array(z.string().min(1).max(500)).max(20),
  important_numbers: z
    .array(
      z.object({
        label: z.string().min(1).max(100),
        value: z.string().min(1).max(100),
      }),
    )
    .max(30),
});

export type ReconstructResult = z.infer<typeof ReconstructResultSchema>;

// ── OpenAI structured outputs JSON Schema ───────────────────
// 모델에 이 스키마를 넘겨주면 JSON 형태를 강제한다.
export const RECONSTRUCT_JSON_SCHEMA = {
  name: "reconstruct_result",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "key_decisions", "action_items", "important_numbers"],
    properties: {
      summary: { type: "string" },
      key_decisions: {
        type: "array",
        items: { type: "string" },
      },
      action_items: {
        type: "array",
        items: { type: "string" },
      },
      important_numbers: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "value"],
          properties: {
            label: { type: "string" },
            value: { type: "string" },
          },
        },
      },
    },
  },
} as const;
