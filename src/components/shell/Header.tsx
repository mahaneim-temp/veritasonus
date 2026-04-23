/**
 * 상단 헤더 (서버 컴포넌트).
 * - 로그인 여부에 따라 "로그인/가입" 또는 <UserMenu /> 를 렌더한다.
 * - cookies() 를 사용하므로 자연스럽게 dynamic 으로 취급된다 (정적 캐시 금지).
 */

import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { supabaseServer } from "@/lib/supabase/server";
import { UserMenu } from "./UserMenu";

export async function Header() {
  const sb = supabaseServer();
  let userEmail: string | null = null;
  let role: string = "member";
  let displayName: string | null = null;

  try {
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (user) {
      userEmail = user.email ?? null;
      const { data } = await sb
        .from("users")
        .select("role, display_name")
        .eq("id", user.id)
        .maybeSingle();
      // @supabase/ssr 의 타입 추론이 `data` 를 `never` 로 좁히는 quirk 회피.
      const row = data as { role?: string | null; display_name?: string | null } | null;
      if (row) {
        role = row.role ?? "member";
        displayName = row.display_name ?? null;
      }
    }
  } catch {
    // 세션/네트워크 실패는 로그아웃 상태로 간주한다 (fail-open for UI).
  }

  const loggedIn = !!userEmail;

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
          {loggedIn ? (
            <UserMenu
              email={userEmail ?? ""}
              displayName={displayName}
              role={role}
            />
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  로그인
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="sm">가입</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
