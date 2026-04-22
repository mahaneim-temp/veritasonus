/**
 * GET /api/sessions/[id]/transcript
 *
 * 세션 발화 전체를 시퀀스 순으로 반환. 사후 검토(/review) 화면용.
 * 권한: 소유자 또는 admin.
 *
 * Query params:
 *   - cursor (number, default 0): seq > cursor 부터 반환 (페이지네이션)
 *   - limit  (number, default 200, max 500)
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorize(sessionId: string) {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const guestId = cookies().get("lucid_guest_id")?.value;

  const { data: row } = await supabaseService()
    .from("sessions")
    .select("owner_type,owner_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!row) return { ok: false as const, code: 404 };
  const r = row as any;
  const isOwner =
    (r.owner_type === "member" && user && r.owner_id === user.id) ||
    (r.owner_type === "guest" && guestId && r.owner_id === guestId);

  let isAdmin = false;
  if (user) {
    const { data: prof } = await sb
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    isAdmin =
      !!prof && ["admin", "superadmin"].includes((prof as any).role);
  }
  if (!isOwner && !isAdmin) return { ok: false as const, code: 403 };
  return { ok: true as const };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await authorize(params.id);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "권한 없음" } },
      { status: auth.code },
    );
  }

  const url = new URL(req.url);
  const cursor = Math.max(0, Number(url.searchParams.get("cursor") ?? 0) || 0);
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get("limit") ?? 200) || 200),
  );

  const { data, error } = await supabaseService()
    .from("utterances")
    .select(
      "id,seq,speaker_label,started_at_ms,ended_at_ms,source_text,corrected_text,translated_text,confidence_level,confidence_score,requires_review,flags,created_at",
    )
    .eq("session_id", params.id)
    .gt("seq", cursor)
    .order("seq", { ascending: true })
    .limit(limit);
  if (error) {
    return NextResponse.json(
      { error: { code: "internal", message: "조회 실패" } },
      { status: 500 },
    );
  }
  const items = data ?? [];
  const nextCursor =
    items.length === limit ? (items[items.length - 1] as any).seq : null;
  return NextResponse.json({ items, next_cursor: nextCursor });
}
