"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabaseClient } from "@/lib/supabase/client";

/**
 * Supabase auth 에러 메시지를 사용자가 이해할 수 있는 한국어로 매핑.
 */
function humanizeAuthError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials"))
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (m.includes("email not confirmed") || m.includes("not confirmed"))
    return "이메일 인증이 완료되지 않았습니다. 메일함의 확인 링크를 먼저 클릭해 주세요. (관리자가 인증 요구를 해제했다면 새 계정으로 다시 가입해 주세요.)";
  if (m.includes("rate limit"))
    return "요청이 많아 일시적으로 제한되었습니다. 잠시 후 다시 시도해 주세요.";
  return raw;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseClient().auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setBusy(false);
      setError(humanizeAuthError(error.message));
      return;
    }
    // 전체 리로드로 middleware 가 새 쿠키를 확실히 집어가게 한다.
    const next = searchParams.get("next") ?? "/";
    window.location.assign(next);
  }

  return (
    <div className="container max-w-md py-16">
      <h1 className="text-2xl font-semibold">로그인</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm text-ink-secondary">이메일</span>
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1"
            autoComplete="email"
          />
        </label>
        <label className="block">
          <span className="text-sm text-ink-secondary">비밀번호</span>
          <Input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1"
            autoComplete="current-password"
          />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "로그인 중…" : "로그인"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-secondary">
        계정이 없으신가요?{" "}
        <Link href={"/signup" as never} className="underline text-ink-primary">
          무료로 가입하기
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="container max-w-md py-16 text-ink-muted">로딩 중…</div>}>
      <LoginForm />
    </Suspense>
  );
}
