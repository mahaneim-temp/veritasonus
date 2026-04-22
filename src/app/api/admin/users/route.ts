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
  return NextResponse.json({
    items: data ?? [],
    total: count ?? 0,
    page,
    size,
  });
}
