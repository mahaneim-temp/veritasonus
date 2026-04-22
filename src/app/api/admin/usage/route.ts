/**
 * GET /api/admin/usage — 관리자 사용량 대시보드 데이터.
 *
 * 기본 응답:
 *   - byMonth: 최근 6개월 집계 (yyyymm 별 총 초, 고유 사용자 수)
 *   - topUsers: 이번 달 상위 사용자 20명
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { kstYyyymm } from "@/lib/billing/quota";
import { logger } from "@/lib/utils/logger";

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

  try {
    const [allRows, topThisMonth] = await Promise.all([
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

    return NextResponse.json({
      this_month: thisMonth,
      byMonth,
      topUsers: topThisMonth.data ?? [],
    });
  } catch (e) {
    logger.error("admin_usage_failed", { e: String(e) });
    return NextResponse.json(
      { error: { code: "internal", message: "집계 실패" } },
      { status: 500 },
    );
  }
}
