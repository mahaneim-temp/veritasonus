/**
 * PATCH /api/sessions/[id]/utterances/[seq]
 *
 * 사용자가 재확인(재검토) 버튼을 눌러 번역을 직접 수정할 때 사용.
 * 기존 translated_text 는 그대로 두고 corrected_text 에만 기록 — 원본과 수정본을 함께 보존.
 *
 * 본문: { corrected_text: string }
 * 권한: 소유자 또는 admin.
 *
 * 참고: requires_review 는 유지한다(다시 수정하고 싶을 수 있으니까). UI 가 corrected_text 존재 여부로
 * "수정됨" 뱃지를 그리고, 사용자가 원할 때 다시 열 수 있다.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  corrected_text: z
    .string()
    .trim()
    .min(1, "수정문을 입력해 주세요")
    .max(4000, "한 번에 4000자까지 수정할 수 있어요"),
});

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
  const r = row as { owner_type: string; owner_id: string };
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
      !!prof && ["admin", "superadmin"].includes((prof as { role: string }).role);
  }
  if (!isOwner && !isAdmin) return { ok: false as const, code: 403 };
  return { ok: true as const };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; seq: string } },
) {
  const auth = await authorize(params.id);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "권한 없음" } },
      { status: auth.code },
    );
  }

  const seq = Number(params.seq);
  if (!Number.isFinite(seq) || seq <= 0) {
    return NextResponse.json(
      { error: { code: "validation", message: "잘못된 seq" } },
      { status: 400 },
    );
  }

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "validation",
          message:
            parsed.error.issues[0]?.message ?? "입력을 확인해 주세요",
        },
      },
      { status: 422 },
    );
  }

  const { data, error } = await supabaseService()
    .from("utterances")
    .update({ corrected_text: parsed.data.corrected_text })
    .eq("session_id", params.id)
    .eq("seq", seq)
    .select("seq,corrected_text")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: { code: "internal", message: "수정 저장 실패" } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: "not_found", message: "해당 발화가 없습니다" } },
      { status: 404 },
    );
  }
  return NextResponse.json({
    seq: (data as { seq: number }).seq,
    corrected_text: (data as { corrected_text: string }).corrected_text,
  });
}
