/**
 * F-1 사용량 쿼터 — 순수 함수 + DB 액세스 래퍼.
 *
 * 단일 진실원: `usage_monthly(user_id, yyyymm, seconds_used, last_warned_at)`.
 * 집계 키: KST(Asia/Seoul) 기준 yyyymm.
 *
 * 호출 지점:
 *   1) gateway: 세션 종료 시 경과 초 수를 addUsageSeconds() 로 누적.
 *   2) 웹앱 API: 세션 생성 전 checkQuotaForUser() 로 차단.
 *   3) gateway: 세션 중 주기적으로 remainingSeconds() 로 감시 (F-1 확장 범위).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types.gen";
import {
  QUOTA_LIMIT_RATIO,
  QUOTA_WARN_RATIO,
  quotaSecondsForRole,
} from "./plans";

type Sb = SupabaseClient<Database>;

// ── 시각 헬퍼 (순수) ───────────────────────────────────────

/** KST yyyymm 문자열. 테스트에서는 now 인자로 고정. */
export function kstYyyymm(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

// ── 쿼터 계산 (순수) ────────────────────────────────────────

export type QuotaStatus = "ok" | "warn_80" | "limit_reached";

export interface QuotaEvaluation {
  status: QuotaStatus;
  usedSeconds: number;
  limitSeconds: number | null;
  /** 0..1, null 이면 상한 미적용. */
  ratio: number | null;
  remainingSeconds: number | null;
}

/** 현재 사용량과 상한을 비교해 상태를 분류. */
export function evaluateQuota(
  usedSeconds: number,
  limitSeconds: number | null,
): QuotaEvaluation {
  if (limitSeconds == null || limitSeconds <= 0) {
    return {
      status: "ok",
      usedSeconds,
      limitSeconds: null,
      ratio: null,
      remainingSeconds: null,
    };
  }
  const ratio = usedSeconds / limitSeconds;
  const remainingSeconds = Math.max(0, limitSeconds - usedSeconds);
  let status: QuotaStatus = "ok";
  if (ratio >= QUOTA_LIMIT_RATIO) status = "limit_reached";
  else if (ratio >= QUOTA_WARN_RATIO) status = "warn_80";
  return { status, usedSeconds, limitSeconds, ratio, remainingSeconds };
}

// ── DB 래퍼 ────────────────────────────────────────────────

export async function getUsageSeconds(
  sb: Sb,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const yyyymm = kstYyyymm(now);
  const { data } = await sb
    .from("usage_monthly")
    .select("seconds_used")
    .eq("user_id", userId)
    .eq("yyyymm", yyyymm)
    .maybeSingle();
  return Number(data?.seconds_used ?? 0);
}

/** 누적. upsert 로 row 가 없으면 새로 생성. */
export async function addUsageSeconds(
  sb: Sb,
  userId: string,
  deltaSeconds: number,
  now: Date = new Date(),
): Promise<number> {
  if (deltaSeconds <= 0) return getUsageSeconds(sb, userId, now);
  const yyyymm = kstYyyymm(now);
  // 원자적 증가를 위해 기존 값을 읽은 뒤 upsert. Postgres 함수(RPC) 가 이상적이지만 v1 은 선읽기 + write.
  const current = await getUsageSeconds(sb, userId, now);
  const next = current + deltaSeconds;
  await sb.from("usage_monthly").upsert(
    {
      user_id: userId,
      yyyymm,
      seconds_used: next,
    },
    { onConflict: "user_id,yyyymm" },
  );
  return next;
}

/** 사용자의 현재 쿼터 상태를 계산. role/plan 정보도 같이 읽는다. */
export async function checkQuotaForUser(
  sb: Sb,
  userId: string,
  now: Date = new Date(),
): Promise<QuotaEvaluation> {
  const [usage, profile] = await Promise.all([
    getUsageSeconds(sb, userId, now),
    sb
      .from("users")
      .select("role")
      .eq("id", userId)
      .maybeSingle()
      .then((r) => r.data),
  ]);
  const limit = quotaSecondsForRole(profile?.role ?? null);
  return evaluateQuota(usage, limit);
}

/** 80% 경고 이메일을 이미 보냈는지 확인 + 기록. 멱등. */
export async function markWarnedIfNeeded(
  sb: Sb,
  userId: string,
  now: Date = new Date(),
): Promise<{ alreadyWarned: boolean }> {
  const yyyymm = kstYyyymm(now);
  const { data } = await sb
    .from("usage_monthly")
    .select("last_warned_at")
    .eq("user_id", userId)
    .eq("yyyymm", yyyymm)
    .maybeSingle();
  if (data?.last_warned_at) return { alreadyWarned: true };
  await sb
    .from("usage_monthly")
    .update({ last_warned_at: now.toISOString() })
    .eq("user_id", userId)
    .eq("yyyymm", yyyymm);
  return { alreadyWarned: false };
}
