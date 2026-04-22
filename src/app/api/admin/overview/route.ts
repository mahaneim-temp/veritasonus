/**
 * GET /api/admin/overview
 *
 * 대시보드 KPI:
 *   - active_sessions      : sessions where state in ('preflight','prepared','live','paused')
 *   - trial_active         : guest_sessions where expires_at > now()
 *   - today_signups        : users created today (KST 자정 기준)
 *   - today_revenue_krw    : billing_events 중 오늘 paid 합계 (KRW)
 *   - abuse_flags          : quality_events(event_type='abuse_flag') 최근 24시간 카운트
 *
 * admin/superadmin 만 접근.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { logger } from "@/lib/utils/logger";
import type { AdminOverviewResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function kstMidnightISO(): string {
  // KST = UTC+9. 오늘(KST) 자정의 UTC ISO.
  const now = new Date();
  const utcMs = now.getTime();
  const kstMs = utcMs + 9 * 3600 * 1000;
  const kst = new Date(kstMs);
  kst.setUTCHours(0, 0, 0, 0);
  const utcMid = new Date(kst.getTime() - 9 * 3600 * 1000);
  return utcMid.toISOString();
}

export async function GET(_req: NextRequest) {
  // RBAC
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthenticated", message: "로그인 필요" } },
      { status: 401 },
    );
  }
  const { data: prof } = await sb
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!prof || !["admin", "superadmin"].includes((prof as any).role)) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "관리자 전용" } },
      { status: 403 },
    );
  }

  const svc = supabaseService();
  const since = kstMidnightISO();
  const abuseSince = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  try {
    const [active, trial, signups, revenue, abuse] = await Promise.all([
      svc
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .in("state", ["preflight", "prepared", "live", "paused"]),
      svc
        .from("guest_sessions")
        .select("id", { count: "exact", head: true })
        .gt("expires_at", new Date().toISOString()),
      svc
        .from("users")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),
      svc
        .from("billing_events")
        .select("payload,created_at")
        .gte("created_at", since)
        .in("event_type", [
          "checkout.session.completed",
          "invoice.paid",
        ]),
      svc
        .from("quality_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "abuse_flag")
        .gte("created_at", abuseSince),
    ]);

    const today_revenue_krw =
      (revenue.data ?? []).reduce((acc: number, row) => {
        const payload = row.payload as { data?: { object?: Record<string, unknown> } } | null;
        const obj = payload?.data?.object ?? {};
        const amount =
          (obj["amount_total"] as number | undefined) ??
          (obj["amount_paid"] as number | undefined) ??
          (obj["amount_due"] as number | undefined) ??
          0;
        const currency =
          (obj["currency"] as string | undefined)?.toLowerCase() ?? "krw";
        if (currency !== "krw") return acc; // v1: KRW만 집계
        return acc + Number(amount || 0);
      }, 0);

    const payload: AdminOverviewResponse = {
      active_sessions: active.count ?? 0,
      trial_active: trial.count ?? 0,
      today_signups: signups.count ?? 0,
      today_revenue_krw,
      abuse_flags: abuse.count ?? 0,
    };
    return NextResponse.json(payload);
  } catch (e) {
    logger.error("admin_overview_failed", { e: String(e) });
    return NextResponse.json(
      { error: { code: "internal", message: "집계 실패" } },
      { status: 500 },
    );
  }
}
