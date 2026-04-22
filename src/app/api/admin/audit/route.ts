/**
 * GET /api/admin/audit — 관리자 감사 로그 조회.
 *
 * 쿼리:
 *   - action (선택): 필터
 *   - target_type (선택): 필터
 *   - page (선택): 0-indexed
 *   - size (선택): 페이지 크기, 최대 100
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

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
  const action = url.searchParams.get("action");
  const targetType = url.searchParams.get("target_type");
  const page = Math.max(0, Number(url.searchParams.get("page") ?? "0"));
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get("size") ?? "50")));
  const from = page * size;
  const to = from + size - 1;

  let query = supabaseService()
    .from("audit_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (action) query = query.eq("action", action);
  if (targetType) query = query.eq("target_type", targetType);

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: "internal", message: "조회 실패" } },
      { status: 500 },
    );
  }
  return NextResponse.json({
    items: data ?? [],
    total: count ?? 0,
    page,
    size,
  });
}
