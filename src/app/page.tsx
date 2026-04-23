import Link from "next/link";
import {
  Zap, ClipboardCheck, Ear, HandHelping, GraduationCap,
  Shield, Languages, Gauge, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModeCard } from "@/components/session/ModeCard";
import { supabaseServer } from "@/lib/supabase/server";

export default async function HomePage() {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const isLoggedIn = !!user;

  return (
    <div>
      {/* Hero */}
      <section className="container pt-14 pb-12 md:pt-24 md:pb-20">
        <div className="max-w-3xl">
          <p className="text-xs uppercase tracking-[0.2em] text-ink-muted">
            중요한 대화를 위한 통역
          </p>
          <h1 className="mt-4 text-4xl md:text-5xl font-semibold tracking-tight text-ink-primary">
            관광 번역기가 아닙니다.
            <br className="hidden md:block" />
            회의, 설교, 강연, 진료를 위한 통역 서비스.
          </h1>
          <p className="mt-5 text-lg text-ink-secondary leading-relaxed">
            {isLoggedIn
              ? "언어쌍을 선택하고 바로 시작하세요. 이번 달 남은 무료 시간을 확인하려면 우측 상단 메뉴를 이용하세요."
              : "1분 맛보기로 품질을 확인하고, 가입하면 매달 10분 무료로 사용할 수 있습니다."}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {isLoggedIn ? (
              <>
                <Link href="/start/quick">
                  <Button size="lg">
                    <Zap className="h-5 w-5" /> 빠른 시작
                  </Button>
                </Link>
                <Link href="/start/prepared">
                  <Button size="lg" variant="secondary">
                    <ClipboardCheck className="h-5 w-5" /> 준비하고 시작
                  </Button>
                </Link>
              </>
            ) : (
              <>
                <Link href={"/trial" as never}>
                  <Button size="lg">
                    <Zap className="h-5 w-5" /> 무료 1분 체험
                  </Button>
                </Link>
                <Link href={"/signup" as never}>
                  <Button size="lg" variant="secondary">
                    <ArrowRight className="h-5 w-5" /> 회원가입 · 월 10분 무료
                  </Button>
                </Link>
              </>
            )}
          </div>
          {!isLoggedIn && (
            <p className="mt-3 text-xs text-ink-muted">
              이미 계정이 있으신가요?{" "}
              <Link href={"/login" as never} className="underline">로그인</Link>
            </p>
          )}
        </div>
      </section>

      {/* Mode grid — 로그인 사용자에게만 표시 */}
      {isLoggedIn && (
        <section className="container pb-16 md:pb-24">
          <h2 className="text-xs uppercase tracking-[0.2em] text-ink-muted mb-4">
            무엇을 하시겠습니까
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <ModeCard href="/start/quick" icon={Zap} title="빠른 시작"
              description="언어쌍과 품질만 선택하고 바로 시작합니다." />
            <ModeCard href="/start/prepared" icon={ClipboardCheck} title="준비하고 시작"
              description="상황·주제·원고를 먼저 알려주면 정확도가 올라갑니다." />
            <ModeCard href="/start/quick?mode=listener_live" icon={Ear} title="듣기만 할래요"
              description="청중 모드. 연설·설교·강연을 실시간으로 이해합니다." />
            <ModeCard href="/start/quick?mode=assist_interpretation" icon={HandHelping}
              title="통역 어시스트"
              description="직접 말하려는데 막힐 때만 단어·표현을 돕습니다." />
            <ModeCard href="#" icon={GraduationCap} title="회화 학습"
              description="상황별 회화 훈련 — 커리큘럼 베타 예정." badge="Beta 예정" disabled />
          </div>
        </section>
      )}

      {/* Non-logged-in: service intro cards */}
      {!isLoggedIn && (
        <section className="container pb-16">
          <h2 className="text-xs uppercase tracking-[0.2em] text-ink-muted mb-4">
            어떤 상황에 사용할 수 있나요
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <ServiceCard icon={<Zap className="h-5 w-5"/>} title="빠른 시작" desc="언어쌍만 선택하고 즉시 통역 시작" />
            <ServiceCard icon={<ClipboardCheck className="h-5 w-5"/>} title="준비하고 시작" desc="원고·용어집을 올리면 고유명사 정확도 향상" />
            <ServiceCard icon={<Ear className="h-5 w-5"/>} title="청중 모드" desc="강연·설교를 실시간 자막으로 이해" />
            <ServiceCard icon={<HandHelping className="h-5 w-5"/>} title="통역 어시스트" desc="막히는 표현만 골라서 제안" />
          </div>
        </section>
      )}

      {/* Trust */}
      <section className="border-y border-border-subtle bg-elev/40">
        <div className="container py-14 md:py-20 grid gap-8 md:grid-cols-3">
          <Feature icon={<Shield className="h-5 w-5" />} title="검토 가능성"
            body="원문·번역문·신뢰도를 한 화면에. 낮은 신뢰도엔 재확인 요청." />
          <Feature icon={<Gauge className="h-5 w-5" />} title="실시간 + 사후 정제"
            body="현장에서는 빠르게, 끝난 후엔 사후 복원본으로 더 정확하게." />
          <Feature icon={<Languages className="h-5 w-5" />} title="원고·용어 바이어싱"
            body="슬라이드·원고·용어집을 올리면 고유명사와 전문 용어가 살아납니다." />
        </div>
      </section>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div>
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm text-ink-secondary leading-relaxed">{body}</p>
    </div>
  );
}

function ServiceCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-5">
      <div className="mb-2 text-primary">{icon}</div>
      <p className="font-medium text-sm text-ink-primary">{title}</p>
      <p className="mt-1 text-xs text-ink-secondary">{desc}</p>
    </div>
  );
}
