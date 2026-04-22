/**
 * POST /api/sessions
 *
 * 새 세션 생성. 회원/게스트 모두 가능.
 *
 * 흐름:
 *   1) auth.user 또는 lucid_guest_id 쿠키 확인.
 *   2) 둘 다 없으면 401 → 클라이언트가 /api/auth/guest/start 호출 후 retry.
 *   3) Zod로 본문 검증.
 *   4) sessions 행 insert (RLS 통과 가능 시 anon, 게스트는 service-role).
 *   5) 응답: { session_id, state: "preflight" }
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { logger } from "@/lib/utils/logger";
import type { CreateSessionResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  mode: z.enum([
    "interactive_interpretation",
    "listener_live",
    "listener_live_recorded",
    "assist_interpretation",
    "conversation_learning",
  ]),
  source_lang: z.string().min(2).max(10),
  target_lang: z.string().min(2).max(10),
  quality_mode: z.enum(["standard", "premium", "auto"]).default("auto"),
  context_note: z.string().max(2000).optional(),
  audience: z.string().max(200).optional(),
  recording_enabled: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const guestId = cookies().get("lucid_guest_id")?.value;

  if (!user && !guestId) {
    return NextResponse.json(
      {
        error: {
          code: "unauthenticated",
          message: "로그인 또는 게스트 세션이 필요합니다.",
        },
      },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "bad_request", message: "JSON 본문 필요" } },
      { status: 400 },
    );
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "validation",
          message: "본문 검증 실패",
          details: parsed.error.flatten(),
        },
      },
      { status: 422 },
    );
  }
  const v = parsed.data;

  const owner_type: "member" | "guest" = user ? "member" : "guest";
  const owner_id = user?.id ?? guestId!;

  // 게스트는 RLS로 sessions 직접 insert 불가 → service-role.
  // 회원도 일관성을 위해 service-role 사용 (rls 회피하지만 owner_id를 검증된 값으로만 씀).
  const insert = {
    owner_type,
    owner_id,
    mode: v.mode,
    state: "preflight" as const,
    source_lang: v.source_lang,
    target_lang: v.target_lang,
    quality_mode: v.quality_mode,
    context_note: v.context_note ?? null,
    audience: v.audience ?? null,
    recording_enabled: v.recording_enabled ?? false,
  };

  try {
    const { data, error } = await supabaseService()
      .from("sessions")
      .insert(insert)
      .select("id,state")
      .single();
    if (error) throw error;
    const payload: CreateSessionResponse = {
      session_id: (data as any).id as string,
      state: "preflight",
    };
    return NextResponse.json(payload, { status: 201 });
  } catch (e) {
    logger.error("sessions_insert_failed", { e: String(e) });
    return NextResponse.json(
      { error: { code: "internal", message: "세션 생성 실패" } },
      { status: 500 },
    );
  }
}
