/**
 * 서버 전용 온보딩/사용자 선호 조회 헬퍼.
 *
 * - RSC, Route Handler, Server Action 에서 사용.
 * - RLS 통과 경로는 supabaseServer() (auth.uid 기반).
 * - 생성/보정은 service-role (RLS bypass) — 트리거가 실패했거나 구 사용자 backfill 대비.
 */

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import type { UserPreferences } from "@/types/user";

/**
 * 현재 로그인 사용자의 preferences 1행을 가져온다.
 * 행이 없으면 service-role 로 빈 행을 만들고 재조회.
 */
export async function getOrCreatePreferences(
  userId: string,
): Promise<UserPreferences | null> {
  const sb = supabaseServer();
  const { data } = await sb
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as unknown as UserPreferences;

  // 트리거가 돌지 않은(구 사용자 또는 경합) 케이스 — service-role 로 빈 행 생성.
  const svc = supabaseService();
  const { data: created, error } = await svc
    .from("user_preferences")
    .insert({ user_id: userId })
    .select("*")
    .single();
  if (error || !created) return null;
  return created as unknown as UserPreferences;
}

/**
 * 온보딩 게이트용 — 사용자가 온보딩을 마쳤는지 여부.
 * 성능 고려: user_id 만으로 조회 (PK 인덱스).
 */
export async function isOnboardingComplete(userId: string): Promise<boolean> {
  const sb = supabaseServer();
  const { data } = await sb
    .from("user_preferences")
    .select("onboarding_completed_at")
    .eq("user_id", userId)
    .maybeSingle();
  const row = data as { onboarding_completed_at: string | null } | null;
  return !!row?.onboarding_completed_at;
}

/**
 * /start/quick 프리필용 — 기본값을 가져온다(없으면 null 필드로).
 */
export async function getPreferredStartDefaults(
  userId: string,
): Promise<{
  source_lang: string | null;
  target_lang: string | null;
  quality_mode: UserPreferences["default_quality_mode"];
} | null> {
  const sb = supabaseServer();
  const { data } = await sb
    .from("user_preferences")
    .select(
      "default_source_lang, default_target_lang, default_quality_mode",
    )
    .eq("user_id", userId)
    .maybeSingle();
  const row = data as
    | Pick<
        UserPreferences,
        "default_source_lang" | "default_target_lang" | "default_quality_mode"
      >
    | null;
  if (!row) return null;
  return {
    source_lang: row.default_source_lang ?? null,
    target_lang: row.default_target_lang ?? null,
    quality_mode: row.default_quality_mode ?? "auto",
  };
}
