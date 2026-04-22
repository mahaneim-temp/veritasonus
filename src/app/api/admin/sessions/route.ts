/**
 * GET /api/admin/sessions — 서버 페이징 + 필터.
 *
 * 쿼리:
 *   - state (선택): enum 필터
 *   - mode (선택): enum 필터
 *   - from (선택): ISO 시작 시각
 *   - to (선택): ISO 종료 시각
 *   - page, size (선택): 기본 0, 50. size 최대 100.
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
  const state = url.searchParams.get("state");
  const mode = url.searchParams.get("mode");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const page = Math.max(0, Number(url.searchParams.get("page") ?? "0"));
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get("size") ?? "50")));
  const rangeFrom = page * size;
  const rangeTo = rangeFrom + size - 1;

  let query = supabaseService()
    .from("sessions")
    .select(
      "id,owner_type,owner_id,mode,state,source_lang,target_lang,recording_enabled,started_at,ended_at,created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(rangeFrom, rangeTo);
  if (state) query = query.eq("state", state as never);
  if (mode) query = query.eq("mode", mode as never);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

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
