/**
 * GET /api/admin/usage — 관리자 사용량 대시보드 데이터.
 *
 * 기본 응답:
 *   - today: 오늘(KST 자정 이후 종료된 세션) 집계 — 총 초수 + 세션 수 + 고유 사용자 수
 *   - byMonth: 최근 6개월 집계 (yyyymm 별 총 초, 고유 사용자 수)
 *   - topUsers: 이번 달 상위 사용자 20명
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { kstYyyymm } from "@/lib/billing/quota";
import { logger } from "@/lib/utils/logger";

function kstMidnightISO(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  kst.setUTCHours(0, 0, 0, 0);
  return new Date(kst.getTime() - 9 * 3600 * 1000).toISOString();
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data: prof } = await sb
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();
  if (!prof || !["admin", "superadmin"].includes(prof.role)) return null;
  return user;
}

export async function GET(_req: NextRequest) {
  const u = await requireAdmin();
  if (!u) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "관리자 전용" } },
      { status: 403 },
    );
  }
  const svc = supabaseService();
  const thisMonth = kstYyyymm();
  const todayStart = kstMidnightISO();

  try {
    const [allRows, topThisMonth, todayRows] = await Promise.all([
      svc
        .from("usage_monthly")
        .select("yyyymm,seconds_used,user_id")
        .order("yyyymm", { ascending: false })
        .limit(2000),
      svc
        .from("usage_monthly")
        .select("user_id,seconds_used")
        .eq("yyyymm", thisMonth)
        .order("seconds_used", { ascending: false })
        .limit(20),
      // 오늘(KST 자정 이후 종료된) 세션 — speech_active_seconds 직접 합산.
      svc
        .from("sessions")
        .select("owner_type,owner_id,speech_active_seconds,ended_at,mode")
        .gte("ended_at", todayStart)
        .not("ended_at", "is", null),
    ]);

    const byMonthMap = new Map<
      string,
      { yyyymm: string; total_seconds: number; users: number }
    >();
    for (const row of allRows.data ?? []) {
      const agg = byMonthMap.get(row.yyyymm) ?? {
        yyyymm: row.yyyymm,
        total_seconds: 0,
        users: 0,
      };
      agg.total_seconds += Number(row.seconds_used ?? 0);
      agg.users += 1;
      byMonthMap.set(row.yyyymm, agg);
    }
    const byMonth = Array.from(byMonthMap.values())
      .sort((a, b) => (a.yyyymm < b.yyyymm ? 1 : -1))
      .slice(0, 6);

    // 오늘 집계 — 종료된 세션의 speech_active_seconds 합산.
    const todayData = todayRows.data ?? [];
    let todayTotalSeconds = 0;
    const todayOwners = new Set<string>();
    for (const row of todayData) {
      todayTotalSeconds += Number(row.speech_active_seconds ?? 0);
      if (row.owner_type === "member" && row.owner_id) {
        todayOwners.add(row.owner_id);
      }
    }

    return NextResponse.json({
      this_month: thisMonth,
      byMonth,
      topUsers: topThisMonth.data ?? [],
      today: {
        since: todayStart,
        total_seconds: todayTotalSeconds,
        session_count: todayData.length,
        active_members: todayOwners.size,
      },
    });
  } catch (e) {
    logger.error("admin_usage_failed", { e: String(e) });
    return NextResponse.json(
      { error: { code: "internal", message: "집계 실패" } },
      { status: 500 },
    );
  }
}
