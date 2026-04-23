/**
 * /start/quick — 서버 컴포넌트로 전환.
 * 로그인 사용자의 user_preferences 기본값을 읽어 클라이언트 폼에 prefill 한다.
 * (온보딩을 건너뛴 사용자는 preferences 가 빈 행이므로 아무것도 채워지지 않음 → 매번 선택)
 */

import { supabaseServer } from "@/lib/supabase/server";
import { getPreferredStartDefaults } from "@/lib/onboarding/preferences";
import { isSupportedLangCode } from "@/lib/constants/languages";
import type { QualityMode } from "@/types/session";
import QuickStartClient from "./client";

export const dynamic = "force-dynamic";

export default async function QuickStartPage() {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  let defaults: {
    source: string | null;
    target: string | null;
    quality: QualityMode;
  } = { source: null, target: null, quality: "auto" };

  if (user) {
    const p = await getPreferredStartDefaults(user.id);
    if (p) {
      defaults = {
        source: p.source_lang && isSupportedLangCode(p.source_lang) ? p.source_lang : null,
        target: p.target_lang && isSupportedLangCode(p.target_lang) ? p.target_lang : null,
        quality: p.quality_mode,
      };
    }
  }

  return <QuickStartClient defaults={defaults} />;
}
