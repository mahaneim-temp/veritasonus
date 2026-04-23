/**
 * 사용자 프로필 / 온보딩 관련 공통 타입.
 * SSOT §9 에 맞춰 supabase/schema.sql 변경과 동기화.
 */

import type { QualityMode, SessionMode } from "./session";

/** 회원가입 Step 2 온보딩에서 수집하는 "사용 목적" 옵션. */
export type PrimaryPurpose =
  | "business_meeting"
  | "church"
  | "medical"
  | "legal"
  | "education"
  | "travel"
  | "media"
  | "personal"
  | "other";

export const PRIMARY_PURPOSE_LABELS: Record<PrimaryPurpose, string> = {
  business_meeting: "비즈니스 회의",
  church: "교회/종교",
  medical: "의료",
  legal: "법률",
  education: "교육/학술",
  travel: "여행/생활",
  media: "미디어/방송",
  personal: "개인/일상",
  other: "기타",
};

/** public.user_preferences 1 행. */
export interface UserPreferences {
  user_id: string;
  primary_purpose: PrimaryPurpose[];
  domain_tags: string[];
  default_source_lang: string | null;
  default_target_lang: string | null;
  preferred_mode: SessionMode | null;
  default_quality_mode: QualityMode;
  wants_term_registration: boolean;
  onboarding_completed_at: string | null;
  updated_at: string;
}

/** 온보딩 완료 여부 판정. */
export function isOnboarded(p: Pick<UserPreferences, "onboarding_completed_at"> | null): boolean {
  return !!p?.onboarding_completed_at;
}

/** 표시 이름 fallback — display_name 이 없으면 이메일 local-part 사용. */
export function resolveDisplayName(opts: {
  display_name?: string | null;
  email?: string | null;
}): string {
  const dn = (opts.display_name ?? "").trim();
  if (dn.length > 0) return dn;
  const email = opts.email ?? "";
  const at = email.indexOf("@");
  if (at > 0) return email.slice(0, at);
  return "사용자";
}
