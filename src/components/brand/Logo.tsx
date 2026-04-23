import { cn } from "@/lib/utils/cn";
import { BRAND_NAME } from "@/lib/brand";

/** 브랜드 로고 — 임시 wordmark. 정식 브랜드 확정 시 SVG 교체. */
export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="inline-block h-6 w-6 rounded-md bg-primary" aria-hidden />
      <span className="font-semibold tracking-tight text-ink-primary">
        {BRAND_NAME}
      </span>
    </div>
  );
}
