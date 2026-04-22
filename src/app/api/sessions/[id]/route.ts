/**
 * GET /api/sessions/[id]
 *   세션 상세 조회. 소유자(회원/게스트) 또는 admin만 가능.
 *
 * PATCH /api/sessions/[id]
 *   상태 전이 (state) 또는 일부 메타 갱신.
 *   허용: state ∈ {paused, live, ended}, recording_enabled toggle.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { logger } from "@/lib/utils/logger";
import type { Database } from "@/lib/supabase/types.gen";

type SessionUpdate = Database["public"]["Tables"]["sessions"]["Update"];

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadAndAuthorize(id: string) {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const guestId = cookies().get("lucid_guest_id")?.value;

  const { data: row, error } = await supabaseService()
    .from("sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!row) return { authorized: false as const, code: 404, row: null };

  const r = row as any;
  // admin?
  let isAdmin = false;
  if (user) {
    const { data: prof } = await sb
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    isAdmin =
      !!prof &&
      ["admin", "superadmin"].includes((prof as any).role as string);
  }

  const isOwner =
    (r.owner_type === "member" && user && r.owner_id === user.id) ||
    (r.owner_type === "guest" && guestId && r.owner_id === guestId);

  if (!isOwner && !isAdmin) {
    return { authorized: false as const, code: 403, row: r };
  }
  return { authorized: true as const, row: r, isAdmin };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const r = await loadAndAuthorize(params.id);
    if (!r.authorized) {
      return NextResponse.json(
        {
          error: {
            code: r.code === 404 ? "not_found" : "forbidden",
            message: r.code === 404 ? "세션 없음" : "권한 없음",
          },
        },
        { status: r.code },
      );
    }
    return NextResponse.json(r.row);
  } catch (e) {
    logger.error("session_get_failed", { e: String(e) });
    return NextResponse.json(
      { error: { code: "internal", message: "조회 실패" } },
      { status: 500 },
    );
  }
}

const PatchSchema = z.object({
  state: z.enum(["live", "paused", "ended"]).optional(),
  recording_enabled: z.boolean().optional(),
  context_note: z.string().max(2000).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await loadAndAuthorize(params.id);
    if (!auth.authorized) {
      return NextResponse.json(
        { error: { code: "forbidden", message: "권한 없음" } },
        { status: auth.code },
      );
    }
    const json = (await req.json()) as unknown;
    const parsed = PatchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "validation", message: "검증 실패" } },
        { status: 422 },
      );
    }

    const patch: SessionUpdate = {};
    if (parsed.data.state) {
      patch.state = parsed.data.state;
      if (parsed.data.state === "live" && !auth.row.started_at)
        patch.started_at = new Date().toISOString();
      if (parsed.data.state === "ended")
        patch.ended_at = new Date().toISOString();
    }
    if (parsed.data.recording_enabled != null)
      patch.recording_enabled = parsed.data.recording_enabled;
    if (parsed.data.context_note != null)
      patch.context_note = parsed.data.context_note;

    const { data, error } = await supabaseService()
      .from("sessions")
      .update(patch)
      .eq("id", params.id)
      .select("id,state")
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    logger.error("session_patch_failed", { e: String(e) });
    return NextResponse.json(
      { error: { code: "internal", message: "갱신 실패" } },
      { status: 500 },
    );
  }
}
