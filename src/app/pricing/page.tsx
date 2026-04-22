import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLANS } from "@/lib/billing/plans";
import Link from "next/link";

export default function PricingPage() {
  return (
    <div className="container max-w-5xl py-14">
      <h1 className="text-3xl font-semibold tracking-tight text-center">
        단순하고 정직한 요금제
      </h1>
      <p className="mt-2 text-center text-ink-secondary">
        먼저 10분 무료 체험으로 품질을 확인하세요.
      </p>

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className="rounded-2xl border border-border-subtle bg-surface p-7 flex flex-col"
          >
            <h3 className="text-sm uppercase tracking-wider text-ink-muted">
              {plan.name}
            </h3>
            <p className="mt-3 text-3xl font-semibold">
              ₩{plan.priceKrw.toLocaleString()}
              <span className="text-sm text-ink-muted font-normal">
                {plan.interval === "monthly"
                  ? " / 월"
                  : plan.interval === "yearly"
                  ? " / 년"
                  : ""}
              </span>
            </p>
            <ul className="mt-6 space-y-2 text-sm text-ink-secondary flex-1">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="h-4 w-4 text-success mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6">
              {plan.id === "free" ? (
                <Link href="/start/quick">
                  <Button variant="secondary" className="w-full">
                    {plan.cta}
                  </Button>
                </Link>
              ) : (
                <form
                  action="/api/billing/checkout"
                  method="POST"
                >
                  <input type="hidden" name="plan" value={plan.id} />
                  <Button className="w-full">{plan.cta}</Button>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
