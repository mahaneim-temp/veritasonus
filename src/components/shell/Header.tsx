import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-border-subtle bg-canvas/80 backdrop-blur">
      <div className="container flex h-14 items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
        </Link>
        <nav className="hidden md:flex items-center gap-1 text-sm">
          <Link
            href="/start/quick"
            className="px-3 py-2 text-ink-secondary hover:text-ink-primary"
          >
            빠른 시작
          </Link>
          <Link
            href="/start/prepared"
            className="px-3 py-2 text-ink-secondary hover:text-ink-primary"
          >
            준비하고 시작
          </Link>
          <Link
            href="/pricing"
            className="px-3 py-2 text-ink-secondary hover:text-ink-primary"
          >
            요금제
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm">
              로그인
            </Button>
          </Link>
          <Link href="/signup">
            <Button size="sm">가입</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
