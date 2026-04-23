"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabaseClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
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
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    // ?next= 파라미터가 있으면 해당 경로로, 없으면 홈으로
    const next = searchParams.get("next") ?? "/";
    router.push(next as never);
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
