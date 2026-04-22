/**
 * POST /api/auth/guest/start
 *
 * 게스트 트라이얼 시작:
 *   1) 초대코드 검증(베타).
 *   2) guest_id (uuid) 생성, HttpOnly cookie `lucid_guest_id` 설정.
 *   3) Redis trial:{guest_id} 카운터 init.
 *   4) public.guest_sessions 행 insert (service-role).
 *   5) rate-limit 적용 (IP 기준).
 *
 * 이 엔드포인트는 quick-start 페이지에서 401 응답을 받으면 자동 호출된다.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { isInviteValid, isInviteRequired } from "@/lib/guest/invite";
import { isSignupRequiredForTrial } from "@/lib/guest/policy";
import { supabaseServer } from "@/lib/supabase/server";
import {
  DEFAULT_TRIAL_SECONDS,
  initTrial,
} from "@/lib/guest/trial";
import { supabaseService } from "@/lib/supabase/service";
import { getLimiter, rateLimit } from "@/lib/ratelimit";
import { logger } from "@/lib/utils/logger";
import type {
  GuestStartRequest,
  GuestStartResponse,
} from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = getLimiter("guest_start", 5, 60); // 5 req/min/IP

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "0.0.0.0"
  );
}

function hashIp(ip: string): string {
  // PIPA: 원문 IP 저장 금지. SHA-256 + 서버 시크릿으로 pseudonymize.
  const salt = process.env.GUEST_IP_HASH_SALT ?? "lucid-default-salt";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = await rateLimit(limiter, ip);
  if (!rl.success) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "잠시 후 다시 시도해주세요." } },
      { status: 429 },
    );
  }

  let body: GuestStartRequest = {};
  try {
    body = (await req.json()) as GuestStartRequest;
  } catch {
    body = {};
  }

  if (isInviteRequired() && !isInviteValid(body.invite_code)) {
    return NextResponse.json(
      {
        error: {
          code: "invite_required",
          message: "초대 코드가 필요합니다.",
        },
      },
      { status: 403 },
    );
  }

  // 공개 베타·상용 전환 시 REQUIRE_SIGNUP_FOR_TRIAL=true 로 켜서 비회원 체험을 차단.
  if (isSignupRequiredForTrial()) {
    const {
      data: { user },
    } = await supabaseServer().auth.getUser();
    if (!user) {
      return NextResponse.json(
        {
          error: {
            code: "signup_required",
            message: "체험을 시작하려면 먼저 회원가입(또는 로그인) 해주세요.",
          },
        },
        { status: 403 },
      );
    }
  }

  const guest_id = uuidv4();
  const expires_at = new Date(Date.now() + DEFAULT_TRIAL_SECONDS * 1000).toISOString();

  // 1. Redis trial counter
  try {
    await initTrial(guest_id, DEFAULT_TRIAL_SECONDS);
  } catch (e) {
    logger.error("trial_init_failed", { e: String(e) });
  }

  // 2. DB row (RLS bypass via service role; guest_sessions는 자체 보안만)
  // 트라이얼 잔여시간은 Redis(trial:{guest_id}) 가 단일 출처. DB 는 세션 메타만.
  try {
    const { error } = await supabaseService()
      .from("guest_sessions")
      .insert({
        id: guest_id,
        ip_hash: hashIp(ip),
        user_agent: body.user_agent ?? req.headers.get("user-agent") ?? null,
        invite_code: body.invite_code ?? null,
        expires_at,
      });
    if (error) throw error;
  } catch (e) {
    logger.error("guest_insert_failed", { e: String(e) });
    return NextResponse.json(
      {
        error: {
          code: "internal",
          message: "게스트 세션을 만들 수 없습니다.",
        },
      },
      { status: 500 },
    );
  }

  const payload: GuestStartResponse = {
    guest_id,
    expires_at,
    trial_seconds: DEFAULT_TRIAL_SECONDS,
  };

  const res = NextResponse.json(payload, { status: 201 });
  res.cookies.set("lucid_guest_id", guest_id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEFAULT_TRIAL_SECONDS + 600, // trial + 10분 grace
  });
  return res;
}
