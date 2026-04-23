/**
 * 지원 언어 단일 출처(SSOT).
 *
 * 이전에는 /start/quick, /start/prepared, /trial 각각에서 같은 배열을 복사해
 * 관리했다(언어 1개 추가하려면 3곳 수정 필요). 모두 이 상수를 임포트하도록 통일한다.
 *
 * 순서 규칙: 한국어 기본, 그 다음 영어, 그 뒤 사용자 기반 크기 순.
 * 코드 값은 OpenAI Realtime API / Whisper 의 언어 코드 (BCP-47 하위 집합) 와 호환.
 */

export interface Language {
  code: string;
  label: string;
}

export const LANGS: readonly Language[] = [
  { code: "ko", label: "한국어" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
] as const;

export const LANG_CODES: readonly string[] = LANGS.map((l) => l.code);

export function isSupportedLangCode(v: unknown): v is string {
  return typeof v === "string" && LANG_CODES.includes(v);
}

export function labelOf(code: string): string {
  return LANGS.find((l) => l.code === code)?.label ?? code;
}
