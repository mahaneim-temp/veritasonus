/**
 * /onboarding/next — 온보딩 직후 모드 선택 안내.
 * 3개 카드(빠른 통역 / 청취 / 준비된 세션) 로 첫 세션 진입을 돕는다.
 * 사용자가 온보딩에서 preferred_mode 를 고른 경우, 해당 카드에 "추천" 뱃지 표시.
 */

import Link from "next/link";
import { Zap, Ear, BookMarked, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabaseServer } from "@/lib/supabase/server";
import { getOrCreatePreferences } from "@/lib/onboarding/preferences";
import type { SessionMode } from "@/types/session";

export const dynamic = "force-dynamic";

type CardDef = {
  title: string;
  sub: string;
  href: string;
  icon: typeof Zap;
  recommendedFor: SessionMode[];
};

const CARDS: CardDef[] = [
  {
    title: "빠른 통역",
    sub: "언어쌍만 확인하고 바로 시작. 대화형 통역의 기본 흐름.",
    href: "/start/quick",
    icon: Zap,
    recommendedFor: ["interactive_interpretation"],
  },
  {
    title: "청취 모드",
    sub: "상대방 발화를 실시간 번역만 본다. 앱을 몰래 쓰지 않고 '나만 이해'.",
    href: "/start/quick?mode=listener_live",
    icon: Ear,
    recommendedFor: ["listener_live", "listener_live_recorded"],
  },
  {
    title: "준비된 세션",
    sub: "회의·설교·발표 전에 맥락·자료를 미리 등록하고 시작. 품질이 가장 좋음.",
    href: "/start/prepared",
    icon: BookMarked,
    recommendedFor: ["assist_interpretation"],
  },
];

export default async function OnboardingNextPage() {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const pref = user ? await getOrCreatePreferences(user.id) : null;
  const preferred = pref?.preferred_mode ?? null;

  return (
    <div className="container max-w-4xl py-10 md:py-16">
      <div className="flex items-center gap-2 text-primary">
        <CheckCircle2 className="h-5 w-5" />
        <span className="text-xs uppercase tracking-widest font-medium">
          가입 완료
        </span>
      </div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        어떻게 시작할까요?
      </h1>
      <p className="mt-2 text-ink-secondary">
        지금 한 번 고르면 다음부턴 바로 그 화면으로 열립니다.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {CARDS.map((c) => {
          const Icon = c.icon;
          const recommended =
            preferred !== null && c.recommendedFor.includes(preferred);
          return (
            <Link key={c.title} href={c.href as never} className="block">
              <Card
                className={[
                  "h-full transition-colors hover:border-primary/60",
                  recommended ? "border-primary" : "",
                ].join(" ")}
              >
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-primary" />
                    <CardTitle>{c.title}</CardTitle>
                  </div>
                  {recommended && (
                    <div className="mt-1 inline-flex self-start rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                      추천 · 선호 모드
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-ink-secondary leading-relaxed">
                    {c.sub}
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="mt-8 rounded-xl border border-border-subtle bg-elev p-4 text-sm text-ink-secondary">
        <p>
          <strong className="text-ink-primary">무료 사용량</strong> · 가입 즉시 매달 10분이 충전됩니다.
          다 쓰면 크레딧 팩으로 충전할 수 있어요.
        </p>
      </div>
    </div>
  );
}
