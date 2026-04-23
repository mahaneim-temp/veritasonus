/**
 * GET /api/admin/users — 서버 페이징 + 필터.
 *
 * 쿼리:
 *   - role (선택): user_role 필터
 *   - q (선택): email like 검색
 *   - page, size: 기본 0, 50
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { kstYyyymm } from "@/lib/billing/quota";

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

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "관리자 전용" } },
      { status: 403 },
    );
  }
  const url = req.nextUrl;
  const role = url.searchParams.get("role");
  const q = url.searchParams.get("q");
  const page = Math.max(0, Number(url.searchParams.get("page") ?? "0"));
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get("size") ?? "50")));
  const rangeFrom = page * size;
  const rangeTo = rangeFrom + size - 1;

  let query = supabaseService()
    .from("users")
    .select("id,email,role,locale,display_name,billing_status,created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(rangeFrom, rangeTo);
  if (role) query = query.eq("role", role as never);
  if (q) query = query.ilike("email", `%${q}%`);

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: "internal", message: "조회 실패" } },
      { status: 500 },
    );
  }

  // 이번 달 사용 시간을 함께 내려준다. 페이지 내의 user 들만 개별 조회해서 merge.
  const items = data ?? [];
  const ids = items.map((u) => u.id);
  const yyyymm = kstYyyymm();
  const usageMap = new Map<string, number>();
  if (ids.length > 0) {
    const { data: usageRows } = await supabaseService()
      .from("usage_monthly")
      .select("user_id,seconds_used")
      .eq("yyyymm", yyyymm)
      .in("user_id", ids);
    for (const row of usageRows ?? []) {
      usageMap.set(row.user_id, Number(row.seconds_used ?? 0));
    }
  }
  // 지갑 잔액도 함께 조회
  const walletMap = new Map<string, { free: number; purchased: number; granted: number }>();
  if (ids.length > 0) {
    const { data: walletRows } = await supabaseService()
      .from("user_wallet")
      .select("user_id,free_seconds_remaining,purchased_seconds,granted_seconds")
      .in("user_id", ids);
    for (const row of walletRows ?? []) {
      walletMap.set(row.user_id, {
        free: Number(row.free_seconds_remaining ?? 0),
        purchased: Number(row.purchased_seconds ?? 0),
        granted: Number(row.granted_seconds ?? 0),
      });
    }
  }

  const enriched = items.map((u) => {
    const w = walletMap.get(u.id);
    return {
      ...u,
      seconds_used_this_month: usageMap.get(u.id) ?? 0,
      wallet_free_remaining: w?.free ?? 0,
      wallet_purchased: w?.purchased ?? 0,
      wallet_granted: w?.granted ?? 0,
    };
  });

  return NextResponse.json({
    items: enriched,
    total: count ?? 0,
    page,
    size,
    yyyymm,
  });
}
