"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabaseClient } from "@/lib/supabase/client";

const LEGAL_VERSION = "2026-04-22";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeMarketing, setAgreeMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreeTerms || !agreePrivacy) {
      setError("이용약관과 개인정보 처리방침에 모두 동의해주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error } = await supabaseClient().auth.signUp({
      email,
      password,
      options: { data: { locale: "ko", marketing_opt_in: agreeMarketing } },
    });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    // 가입 직후 consent_logs 에 동의 이력 기록 (서버 side 엔드포인트 사용).
    try {
      const userId = data.user?.id;
      if (userId) {
        await fetch("/api/account/consent", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            kinds: ["terms_of_service", "privacy_policy"],
            version: LEGAL_VERSION,
            marketing_opt_in: agreeMarketing,
          }),
        });
      }
    } catch {
      // 비동기 best-effort. 실패해도 가입 자체는 완료.
    }
    setBusy(false);
    router.push("/");
  }

  return (
    <div className="container max-w-md py-16">
      <h1 className="text-2xl font-semibold">회원 가입</h1>
      <p className="mt-1.5 text-sm text-ink-secondary">
        가입 후 매달 10분 무료로 Lucid Interpret을 사용할 수 있습니다.
      </p>
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
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1"
            autoComplete="new-password"
          />
        </label>

        <div className="space-y-2 pt-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={agreeTerms}
              onChange={(e) => setAgreeTerms(e.target.checked)}
              className="mt-0.5"
              required
            />
            <span>
              <Link
                href="/legal/terms"
                target="_blank"
                className="underline"
              >
                이용약관
              </Link>
              에 동의합니다. (필수)
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={agreePrivacy}
              onChange={(e) => setAgreePrivacy(e.target.checked)}
              className="mt-0.5"
              required
            />
            <span>
              <Link
                href="/legal/privacy"
                target="_blank"
                className="underline"
              >
                개인정보 처리방침
              </Link>
              에 동의합니다. (필수)
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={agreeMarketing}
              onChange={(e) => setAgreeMarketing(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-ink-secondary">
              서비스 업데이트, 할인 혜택 등 마케팅 정보 수신에 동의합니다. (선택)
            </span>
          </label>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        <Button
          type="submit"
          className="w-full"
          disabled={busy || !agreeTerms || !agreePrivacy}
        >
          {busy ? "가입 중…" : "가입하기"}
        </Button>
      </form>
    </div>
  );
}
