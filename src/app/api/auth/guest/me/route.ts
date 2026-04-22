/**
 * GET /api/auth/guest/me
 *
 * 현재 게스트 트라이얼 잔여 시간 + 만료 시각 반환.
 * useGuestTrial 훅이 30초마다 폴링한다.
 *
 * 인증 우선순위:
 *   1) auth.user 가 있으면 → guest 상태 아님 (401 또는 200/null)
 *   2) lucid_guest_id 쿠키
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { getRemaining, DEFAULT_TRIAL_SECONDS } from "@/lib/guest/trial";
import { supabaseService } from "@/lib/supabase/service";
import { logger } from "@/lib/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  // 회원이면 401 (게스트 아님)
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (user) {
    return NextResponse.json(
      { authenticated: true, role: "member" },
      { status: 200 },
    );
  }

  const guestId = cookies().get("lucid_guest_id")?.value;
  if (!guestId) {
    return NextResponse.json(
      { error: { code: "no_guest", message: "게스트 세션 없음" } },
      { status: 401 },
    );
  }

  // Redis가 진실의 원천. fallback으로 DB.
  let remaining = await getRemaining(guestId);
  let expires_at: string | null = null;

  try {
    const { data } = await supabaseService()
      .from("guest_sessions")
      .select("expires_at,trial_seconds_total,trial_seconds_remaining")
      .eq("id", guestId)
      .maybeSingle();
    if (data) {
      expires_at = (data as any).expires_at;
      if (remaining == null) {
        // Redis 미구성 → DB 기준 잔여 시간
        const exp = new Date((data as any).expires_at).getTime();
        remaining = Math.max(0, Math.floor((exp - Date.now()) / 1000));
      }
    }
  } catch (e) {
    logger.warn("guest_me_db_fail", { e: String(e) });
  }

  if (remaining == null) remaining = DEFAULT_TRIAL_SECONDS; // 안전 기본

  return NextResponse.json({
    guest_id: guestId,
    trial_remaining_s: remaining,
    expires_at,
  });
}
