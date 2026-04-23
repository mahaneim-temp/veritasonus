/**
 * POST /api/realtime/token
 *
 * realtime-gateway WebSocket에 인증할 ephemeral JWT를 발급.
 *
 * 본문: { session_id }
 * 응답: { token, gateway_url, expires_at }
 *
 * 보안:
 *   - 호출자는 반드시 해당 세션의 소유자여야 한다.
 *   - guest 인 경우 trial_remaining_s 를 클레임에 박아 보낸다.
 *     (gateway 가 음원 스트림 도중 0초가 되면 즉시 종료한다.)
 *   - TTL 기본 15분. 실제 세션이 길면 클라이언트가 만료 5분 전 재발급해야 한다.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { signRealtimeToken } from "@/lib/realtime/token";
import {
  getRemaining,
  DEFAULT_TRIAL_SECONDS,
} from "@/lib/guest/trial";
import { getLimiter, rateLimit } from "@/lib/ratelimit";
import { checkWalletQuota } from "@/lib/billing/quota";
import { logger } from "@/lib/utils/logger";
import type { RealtimeTokenResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ session_id: z.string().uuid() });
const limiter = getLimiter("realtime_token", 10, 60); // 10 req/min/owner

function gatewayUrl(): string {
  const u =
    process.env.NEXT_PUBLIC_REALTIME_GATEWAY_URL ??
    process.env.REALTIME_GATEWAY_URL ??
    "ws://localhost:8787";
  return u;
}

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation", message: "session_id 필요" } },
      { status: 422 },
    );
  }

  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const guestId = cookies().get("lucid_guest_id")?.value;

  if (!user && !guestId) {
    return NextResponse.json(
      { error: { code: "unauthenticated", message: "로그인 필요" } },
      { status: 401 },
    );
  }

  const ownerKey = user?.id ?? guestId!;
  const rl = await rateLimit(limiter, ownerKey);
  if (!rl.success) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "잠시 후 다시 시도" } },
      { status: 429 },
    );
  }

  const { data: srow } = await supabaseService()
    .from("sessions")
    .select("owner_type,owner_id,state,source_lang,target_lang")
    .eq("id", parsed.data.session_id)
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
  if (r.state === "ended" || r.state === "completed") {
    return NextResponse.json(
      { error: { code: "session_closed", message: "이미 종료된 세션" } },
      { status: 409 },
    );
  }

  let trialRemaining = Number.POSITIVE_INFINITY;
  if (r.owner_type === "guest" && guestId) {
    const left = await getRemaining(guestId);
    trialRemaining = left ?? DEFAULT_TRIAL_SECONDS;
    if (trialRemaining <= 0) {
      return NextResponse.json(
        {
          error: {
            code: "trial_expired",
            message: "체험이 끝났습니다. 회원 가입으로 이어가세요.",
          },
        },
        { status: 402 },
      );
    }
  }

  // 지갑 쿼터: 회원 세션이면 유효 잔여 확인. 초과 시 토큰 미발급.
  let memberEffectiveRemaining: number | null = null;
  if (r.owner_type === "member" && user) {
    const walletResult = await checkWalletQuota(supabaseService(), user.id);
    if (!walletResult.allowed) {
      return NextResponse.json(
        {
          error: {
            code: "quota_exceeded",
            message:
              "사용 가능한 시간이 없습니다. 충전 후 이용하거나 관리자에게 시간 추가를 요청하세요.",
            details: {
              remaining_seconds: walletResult.remainingSeconds ?? 0,
            },
          },
        },
        { status: 402 },
      );
    }
    memberEffectiveRemaining = walletResult.remainingSeconds; // null = unlimited (admin)
  }

  try {
    const { token, expires_at } = await signRealtimeToken(
      {
        sub: ownerKey,
        owner_type: r.owner_type,
        session_id: parsed.data.session_id,
        // Number.POSITIVE_INFINITY는 JSON에 잘 안 실리므로 큰 정수로 클램프
        trial_remaining_s: Number.isFinite(trialRemaining)
          ? Math.floor(trialRemaining)
          : 24 * 3600,
        // 회원 유효 잔여: null(무제한) → 큰 값으로 클램프
        effective_remaining_s:
          r.owner_type === "member"
            ? memberEffectiveRemaining != null
              ? Math.floor(memberEffectiveRemaining)
              : 24 * 3600
            : Math.floor(trialRemaining === Number.POSITIVE_INFINITY ? 24 * 3600 : trialRemaining),
        skip_persist: false,
        source_lang: String(r.source_lang ?? "ko"),
        target_lang: String(r.target_lang ?? "en"),
      },
      Number(process.env.REALTIME_TOKEN_TTL_S ?? 900),
    );
    const payload: RealtimeTokenResponse = {
      token,
      gateway_url: gatewayUrl(),
      expires_at,
    };
    return NextResponse.json(payload);
  } catch (e) {
    logger.error("realtime_token_sign_failed", { e: String(e) });
    return NextResponse.json(
      { error: { code: "internal", message: "토큰 발급 실패" } },
      { status: 500 },
    );
  }
}
