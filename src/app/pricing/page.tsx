import { Check, Info, Zap } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CREDIT_PACKS, PACK_PRICING_IS_ASSUMED } from "@/lib/billing/plans";
import { PricingFinePrint } from "@/components/legal/PricingFinePrint";

function fmtMin(s: number) {
  return Math.round(s / 60).toLocaleString();
}

export default function PricingPage() {
  return (
    <div className="container max-w-5xl py-14 space-y-10">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">충전제 요금</h1>
        <p className="mt-2 text-ink-secondary">
          구독 없이 필요한 만큼만 충전해서 사용하세요.
        </p>
      </div>

      {PACK_PRICING_IS_ASSUMED && (
        <div className="mx-auto max-w-3xl flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-ink-secondary">
          <Info className="h-4 w-4 mt-0.5 text-warning shrink-0" />
          <p>
            아래 가격·분수는{" "}
            <strong className="text-ink-primary">공식 확정 전 가정값</strong>입니다.
            Google Cloud 원가 실측 후 최종 가격을 확정합니다.
          </p>
        </div>
      )}

      {/* 무료 회원 안내 */}
      <div className="mx-auto max-w-3xl rounded-2xl border border-primary/20 bg-primary/5 p-5 flex items-start gap-3">
        <Zap className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <div>
          <p className="font-medium text-ink-primary">회원가입만 해도 매달 10분 무료</p>
          <p className="mt-0.5 text-sm text-ink-secondary">
            이월 없음 · 매달 자동 지급 · 가입 후 바로 사용 가능
          </p>
          <Link href="/signup" className="mt-3 inline-block">
            <Button size="sm">무료로 시작 →</Button>
          </Link>
        </div>
      </div>

      {/* Pack cards */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        {CREDIT_PACKS.map((pack) => {
          const pricePerMin = pack.priceKrw / (pack.totalSeconds / 60);
          return (
            <div
              key={pack.id}
              className={[
                "rounded-2xl border p-6 flex flex-col relative",
                pack.highlight
                  ? "border-primary bg-primary/5"
                  : "border-border-subtle bg-surface",
              ].join(" ")}
            >
              {pack.highlight && (
                <span className="absolute -top-3 left-4 rounded-full bg-primary px-3 py-0.5 text-xs text-primary-fg font-medium">
                  인기
                </span>
              )}
              <p className="text-xs uppercase tracking-wider text-ink-muted">{pack.label}</p>
              <p className="mt-2 text-3xl font-semibold">
                ₩{pack.priceKrw.toLocaleString()}
              </p>
              {PACK_PRICING_IS_ASSUMED && (
                <p className="text-[11px] text-warning mt-0.5">가정값</p>
              )}
              <div className="mt-4 space-y-1.5 text-sm text-ink-secondary flex-1">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-success shrink-0" />
                  <span>총 {fmtMin(pack.totalSeconds)}분</span>
                </div>
                {pack.bonusSeconds > 0 && (
                  <div className="flex items-center gap-2 text-xs text-ink-muted">
                    <span className="pl-6">
                      기본 {fmtMin(pack.seconds)}분 + 보너스 {fmtMin(pack.bonusSeconds)}분
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-ink-muted">
                  <span className="pl-6">분당 약 ₩{Math.round(pricePerMin)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-success shrink-0" />
                  <span>충전분 만료 없음</span>
                </div>
              </div>
              <form action="/api/billing/checkout/mock-topup" method="POST" className="mt-5">
                <input type="hidden" name="pack_id" value={pack.id} />
                <Button
                  className="w-full"
                  variant={pack.highlight ? "primary" : "secondary"}
                >
                  충전하기
                </Button>
              </form>
            </div>
          );
        })}
      </div>

      {/* Fine print */}
      <div className="mx-auto max-w-3xl">
        <PricingFinePrint />
      </div>
    </div>
  );
}
