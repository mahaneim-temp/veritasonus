/**
 * GET /api/sessions/[id]/summary
 *
 * 세션 요약(가장 최근 reconstruction 의 summary, key_decisions, action_items, important_numbers).
 * 권한: 소유자 또는 admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const guestId = cookies().get("lucid_guest_id")?.value;

  const { data: srow } = await supabaseService()
    .from("sessions")
    .select("owner_type,owner_id,topic_guess,audience,started_at,ended_at,mode")
    .eq("id", params.id)
    .maybeSingle();
  if (!srow) {
    return NextResponse.json(
      { error: { code: "not_found", message: "세션 없음" } },
      { status: 404 },
    );
  }
  const r = srow as any;
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
  if (!isOwner && !isAdmin) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "권한 없음" } },
      { status: 403 },
    );
  }

  const { data: rec } = await supabaseService()
    .from("reconstructions")
    .select(
      "id,status,summary,key_decisions,action_items,important_numbers,completed_at",
    )
    .eq("session_id", params.id)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    session: r,
    reconstruction: rec ?? null,
  });
}
