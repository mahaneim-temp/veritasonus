import Link from "next/link";
import { BRAND_NAME, BRAND_TAGLINE, BRAND_OPERATOR, BRAND_SUPPORT_EMAIL } from "@/lib/brand";

export function Footer() {
  return (
    <footer className="border-t border-border-subtle bg-canvas">
      <div className="container py-10 space-y-6 text-sm text-ink-secondary">
        {/* Top row: brand + nav */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="font-medium text-ink-primary">{BRAND_NAME}</p>
            <p className="mt-1 text-xs">{BRAND_TAGLINE}</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
            <Link href={"/pricing" as never}>요금 충전</Link>
            <Link href={"/legal/terms" as never}>이용약관</Link>
            <Link href={"/legal/privacy" as never}>개인정보처리방침</Link>
            <Link href={"/legal/refund" as never}>환불 정책</Link>
            <Link href={"/legal/business" as never}>사업자 정보</Link>
            <a href={`mailto:${BRAND_SUPPORT_EMAIL}`}>고객센터</a>
          </nav>
        </div>
        {/* Business info summary (통신판매업 표시 의무 — 실제 정보는 /legal/business 에서 교체) */}
        <p className="text-xs text-ink-muted border-t border-border-subtle pt-4">
          {BRAND_OPERATOR} · 대표: (지정 필요) · 사업자등록번호: 000-00-00000 · 통신판매업: 제0000호
          {" "}·{" "}
          <a href="/legal/business" className="underline">자세히</a>
          {" "}|{" "}
          © {new Date().getFullYear()} {BRAND_NAME}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
