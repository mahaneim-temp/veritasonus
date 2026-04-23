/**
 * TrialBanner 의 서버 측 gate.
 * 로그인된 사용자는 게스트 트라이얼 배너가 필요 없으므로 아예 렌더하지 않는다.
 * (기존 TrialBanner 는 클라이언트에서 쿠키 기반으로 표시하는데, 로그인해도
 *  잔존 guest_id 쿠키 때문에 "남은 시간 0:00" 배너가 뜨던 문제를 해결.)
 */

import { supabaseServer } from "@/lib/supabase/server";
import { TrialBanner } from "./TrialBanner";

export async function TrialBannerGate() {
  try {
    const sb = supabaseServer();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (user) return null;
  } catch {
    // 세션 조회 실패는 비로그인 취급 — 배너 표시.
  }
  return <TrialBanner />;
}
