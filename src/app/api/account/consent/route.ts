/**
 * POST /api/account/consent
 *
 * 동의(약관·처리방침·리스너 등) 이력 기록. C-1 PIPA 최소 요건.
 * 회원 / 게스트 모두 호출 가능 — actor_type 과 actor_id 는 서버가 판별.
 *
 * body:
 *   { kinds: string[], version?: string, session_id?: string, user_id?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash } from "crypto";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { logger } from "@/lib/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  kinds: z
    .array(
      z.enum([
        "terms_of_service",
        "privacy_policy",
        "listener_third_party",
        "marketing",
      ]),
    )
    .min(1)
    .max(10),
  version: z.string().max(40).optional(),
  session_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  marketing_opt_in: z.boolean().optional(),
});

function hashIp(ip: string): string {
  const salt = process.env.GUEST_IP_HASH_SALT ?? "lucid-default-salt";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "0.0.0.0"
  );
}

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation", message: "검증 실패" } },
      { status: 422 },
    );
  }

  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const guestId = cookies().get("lucid_guest_id")?.value;

  let actor_type: "member" | "guest";
  let actor_id: string;
  if (user) {
    actor_type = "member";
    actor_id = user.id;
    // 가입 직후 호출의 경우, body.user_id 와 세션 user 일치 검증 생략
    // (session 이 아직 저장 안 됐을 수 있음 — best-effort).
    if (parsed.data.user_id && parsed.data.user_id !== user.id) {
      return NextResponse.json(
        { error: { code: "forbidden", message: "user_id 불일치" } },
        { status: 403 },
      );
    }
  } else if (guestId) {
    actor_type = "guest";
    actor_id = guestId;
  } else if (parsed.data.user_id) {
    // 가입 직후 세션 쿠키가 아직 서버 쪽에 반영되지 않은 경우의 fallback.
    actor_type = "member";
    actor_id = parsed.data.user_id;
  } else {
    return NextResponse.json(
      { error: { code: "unauthenticated", message: "식별 불가" } },
      { status: 401 },
    );
  }

  const ipHash = hashIp(clientIp(req));
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;

  const rows = parsed.data.kinds.map((kind) => ({
    actor_type,
    actor_id,
    session_id: parsed.data.session_id ?? null,
    kind,
    version: parsed.data.version ?? null,
    ip_hash: ipHash,
    user_agent: userAgent,
  }));

  try {
    const { error } = await supabaseService()
      .from("consent_logs")
      .insert(rows);
    if (error) throw error;
  } catch (e) {
    logger.error("consent_log_failed", { e: String(e) });
    return NextResponse.json(
      { error: { code: "internal", message: "기록 실패" } },
      { status: 500 },
    );
  }

  // 마케팅 수신 동의 처리
  if (parsed.data.marketing_opt_in === true && actor_type === "member") {
    await supabaseService()
      .from("users")
      .update({
        marketing_opt_in: true,
        marketing_opt_in_at: new Date().toISOString(),
      })
      .eq("id", actor_id);
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
