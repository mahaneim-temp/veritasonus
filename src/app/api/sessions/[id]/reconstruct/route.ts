/**
 * POST /api/sessions/[id]/reconstruct
 *
 * 사후 복원(post-session reconstruction) 작업을 큐잉.
 *   - 즉시 reconstructions 행 생성 (status='pending').
 *   - 실제 복원은 별도 워커(Edge Cron 또는 Fly worker)가 pending 행을 polling.
 *   - free 사용자: 1회 미리보기만 (이미 1건 있으면 force=false → 409).
 *
 * 본문:
 *   { include_recording?: boolean, force?: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { logger } from "@/lib/utils/logger";
import type { ReconstructResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  include_recording: z.boolean().optional(),
  force: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const guestId = cookies().get("lucid_guest_id")?.value;

  const { data: srow } = await supabaseService()
    .from("sessions")
    .select("owner_type,owner_id,state,ended_at")
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
  if (!isOwner) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "권한 없음" } },
      { status: 403 },
    );
  }
  if (!r.ended_at) {
    return NextResponse.json(
      {
        error: {
          code: "session_not_ended",
          message: "세션 종료 후에 복원할 수 있습니다.",
        },
      },
      { status: 409 },
    );
  }

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation", message: "검증 실패" } },
      { status: 422 },
    );
  }

  // 회원 등급 확인 (free 사용자는 1회 미리보기만)
  let isPaid = false;
  if (user) {
    const { data: prof } = await sb
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    isPaid =
      !!prof && ["paid", "admin", "superadmin"].includes((prof as any).role);
  }

  if (!isPaid && !parsed.data.force) {
    const { count } = await supabaseService()
      .from("reconstructions")
      .select("id", { count: "exact", head: true })
      .eq("session_id", params.id);
    if ((count ?? 0) >= 1) {
      return NextResponse.json(
        {
          error: {
            code: "quota_exceeded",
            message:
              "Free 등급은 사후 복원을 1회만 미리볼 수 있어요. Pro로 업그레이드하면 무제한 사용 가능합니다.",
          },
        },
        { status: 402 },
      );
    }
  }

  try {
    const { data, error } = await supabaseService()
      .from("reconstructions")
      .insert({
        session_id: params.id,
        status: "pending",
        include_recording: parsed.data.include_recording ?? false,
        retry_count: 0,
      })
      .select("id")
      .single();
    if (error) throw error;
    const payload: ReconstructResponse = {
      reconstruction_id: (data as any).id as string,
      status: "pending",
    };
    return NextResponse.json(payload, { status: 202 });
  } catch (e) {
    logger.error("reconstruct_enqueue_failed", { e: String(e) });
    return NextResponse.json(
      { error: { code: "internal", message: "복원 요청 실패" } },
      { status: 500 },
    );
  }
}
