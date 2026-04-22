/**
 * /api/account/data — 회원 본인 데이터 삭제 (C-1 PIPA 최소 요건).
 *
 * DELETE:
 *   - 인증된 회원 본인의 모든 세션 + 관련 utterances/reconstructions/session_assets/quality_events/billing_events
 *     → ON DELETE CASCADE 덕분에 sessions 한 번 삭제로 연쇄 삭제.
 *   - usage_monthly, consent_logs 는 별도 삭제.
 *   - auth.users 및 public.users 자체 삭제는 Supabase admin API 필요 —
 *     현 구현은 관련 컨텐츠만 삭제하고 계정 shell 은 유지(향후 확장).
 *   - Stripe 구독이 active 면 응답에 "별도 해지 필요" 안내.
 *
 * GET (선택): 수집·보유된 데이터 요약 응답 — 투명성.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireMember() {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  return user;
}

export async function GET(_req: NextRequest) {
  const user = await requireMember();
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthenticated", message: "로그인 필요" } },
      { status: 401 },
    );
  }
  const svc = supabaseService();
  const [sessions, consents, usage] = await Promise.all([
    svc
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("owner_type", "member")
      .eq("owner_id", user.id),
    svc
      .from("consent_logs")
      .select("id", { count: "exact", head: true })
      .eq("actor_type", "member")
      .eq("actor_id", user.id),
    svc
      .from("usage_monthly")
      .select("yyyymm,seconds_used")
      .eq("user_id", user.id)
      .order("yyyymm", { ascending: false })
      .limit(6),
  ]);
  return NextResponse.json({
    sessions_count: sessions.count ?? 0,
    consent_logs_count: consents.count ?? 0,
    usage_last_6_months: usage.data ?? [],
  });
}

export async function DELETE(_req: NextRequest) {
  const user = await requireMember();
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthenticated", message: "로그인 필요" } },
      { status: 401 },
    );
  }
  const svc = supabaseService();
  const errors: string[] = [];

  // 1. 세션 삭제 (ON DELETE CASCADE → utterances/reconstructions/session_assets/quality_events/billing_events 연쇄).
  try {
    const { error } = await svc
      .from("sessions")
      .delete()
      .eq("owner_type", "member")
      .eq("owner_id", user.id);
    if (error) errors.push(`sessions: ${error.message}`);
  } catch (e) {
    errors.push(`sessions: ${String(e)}`);
  }

  // 2. consent_logs (actor_type='member' AND actor_id=user.id).
  try {
    const { error } = await svc
      .from("consent_logs")
      .delete()
      .eq("actor_type", "member")
      .eq("actor_id", user.id);
    if (error) errors.push(`consent_logs: ${error.message}`);
  } catch (e) {
    errors.push(`consent_logs: ${String(e)}`);
  }

  // 3. usage_monthly.
  try {
    const { error } = await svc
      .from("usage_monthly")
      .delete()
      .eq("user_id", user.id);
    if (error) errors.push(`usage_monthly: ${error.message}`);
  } catch (e) {
    errors.push(`usage_monthly: ${String(e)}`);
  }

  // 4. billing 구독 존재 여부 안내 (삭제는 하지 않음 — Stripe dashboard 에서 해지 필요).
  const { data: userRow } = await svc
    .from("users")
    .select("billing_status")
    .eq("id", user.id)
    .maybeSingle();
  const hasActiveSubscription =
    (userRow?.billing_status ?? "") === "active";

  // 감사 로그 (성공/부분성공 모두 기록).
  await audit({
    actorId: user.id,
    action: "data_delete",
    targetType: "user",
    targetId: user.id,
    payload: {
      ok: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      stripe_active: hasActiveSubscription,
    },
  });

  if (errors.length > 0) {
    logger.error("account_data_delete_partial", { user: user.id, errors });
    return NextResponse.json(
      {
        partial: true,
        errors,
        stripe_subscription_active: hasActiveSubscription,
      },
      { status: 207 },
    );
  }

  return NextResponse.json({
    ok: true,
    stripe_subscription_active: hasActiveSubscription,
    note: hasActiveSubscription
      ? "결제 구독이 활성화되어 있습니다. 별도로 해지하셔야 합니다."
      : "모든 데이터가 삭제되었습니다.",
  });
}
