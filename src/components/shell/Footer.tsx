import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border-subtle bg-canvas">
      <div className="container flex flex-col gap-4 py-10 md:flex-row md:items-center md:justify-between text-sm text-ink-secondary">
        <p>© {new Date().getFullYear()} Lucid Interpret</p>
        <nav className="flex gap-5">
          <Link href="/pricing">요금제</Link>
          <Link href="/legal/terms">이용약관</Link>
          <Link href="/legal/privacy">개인정보처리방침</Link>
          <a href="mailto:support@lucid-interpret.app">문의</a>
        </nav>
      </div>
    </footer>
  );
}
