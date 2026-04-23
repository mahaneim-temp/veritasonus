/**
 * PATCH /api/account/marketing
 * 마케팅 수신 동의 on/off 토글.
 * body: { opt_in: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ opt_in: z.boolean() });

export async function PATCH(req: NextRequest) {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthenticated" } },
      { status: 401 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation", message: "opt_in(boolean) 필요" } },
      { status: 422 },
    );
  }

  const { opt_in } = parsed.data;
  const now = new Date().toISOString();

  const { error } = await supabaseService()
    .from("users")
    .update(
      opt_in
        ? { marketing_opt_in: true, marketing_opt_in_at: now }
        : { marketing_opt_in: false, marketing_opt_out_at: now },
    )
    .eq("id", user.id);

  if (error) {
    return NextResponse.json(
      { error: { code: "internal", message: "업데이트 실패" } },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, opt_in });
}

export async function GET(req: NextRequest) {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthenticated" } },
      { status: 401 },
    );
  }

  const { data } = await supabaseService()
    .from("users")
    .select("marketing_opt_in,marketing_opt_in_at,marketing_opt_out_at")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.json({
    opt_in: data?.marketing_opt_in ?? false,
    opt_in_at: data?.marketing_opt_in_at ?? null,
    opt_out_at: data?.marketing_opt_out_at ?? null,
  });
}
