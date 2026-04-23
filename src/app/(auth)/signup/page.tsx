"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabaseClient } from "@/lib/supabase/client";
import { BRAND_NAME } from "@/lib/brand";

const LEGAL_VERSION = "2026-04-22";

/**
 * Supabase auth 에러 메시지를 사용자가 이해할 수 있는 한국어로 매핑.
 * 예: "email rate limit exceeded" → "메일 발송 한도…"
 */
function humanizeAuthError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("rate limit"))
    return "메일 발송 한도에 도달했습니다. 1시간 후 다시 시도하거나, 관리자에게 요청하세요.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "이미 가입된 이메일입니다. 로그인해 주세요.";
  if (m.includes("password") && m.includes("short"))
    return "비밀번호는 최소 8자 이상이어야 합니다.";
  if (m.includes("invalid") && m.includes("email"))
    return "유효한 이메일 주소를 입력해 주세요.";
  return raw; // fallback — 원문 그대로
}

function SignupForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeMarketing, setAgreeMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Confirm email ON 이면 data.session 이 없다 → 안내 화면으로 대체.
  const [verifySent, setVerifySent] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreeTerms || !agreePrivacy) {
      setError("이용약관과 개인정보 처리방침에 모두 동의해주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    const dn = displayName.trim();
    const { data, error } = await supabaseClient().auth.signUp({
      email,
      password,
      options: {
        data: {
          locale: "ko",
          display_name: dn.length > 0 ? dn : null,
          marketing_opt_in: agreeMarketing,
        },
      },
    });
    if (error) {
      setBusy(false);
      setError(humanizeAuthError(error.message));
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

    // Confirm email ON 이면 session 이 없다. 안내 화면으로 전환.
    if (!data.session) {
      setBusy(false);
      setVerifySent(email);
      return;
    }

    // 세션 발급됨 → /onboarding 으로. router.push 대신 window.location 으로
    // 전체 리로드하여 middleware 가 확실히 쿠키를 읽게 한다(쿠키 sync race 방지).
    const next = searchParams.get("next");
    const dest = next
      ? `/onboarding?next=${encodeURIComponent(next)}`
      : "/onboarding";
    window.location.assign(dest);
  }

  if (verifySent) {
    return (
      <div className="container max-w-md py-16">
        <h1 className="text-2xl font-semibold">메일함을 확인해 주세요</h1>
        <p className="mt-3 text-sm text-ink-secondary">
          <span className="font-medium text-ink-primary">{verifySent}</span> 로
          인증 메일을 보냈습니다. 메일의 링크를 클릭하면 로그인되고 온보딩으로 이어집니다.
        </p>
        <p className="mt-3 text-xs text-ink-muted">
          메일이 오지 않았다면 스팸함을 확인해 주세요. 시간당 발송 한도가 있어
          여러 번 시도하면 일시적으로 차단될 수 있습니다.
        </p>
        <div className="mt-6">
          <Link href={"/login" as never}>
            <Button variant="secondary" className="w-full">
              로그인 화면으로
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-md py-16">
      <h1 className="text-2xl font-semibold">회원 가입</h1>
      <p className="mt-1.5 text-sm text-ink-secondary">
        2단계로 끝납니다. 먼저 계정을 만들고, 다음 화면에서 쓰임새를 알려주세요.
        가입 후 매달 10분 무료로 {BRAND_NAME}을 사용할 수 있습니다.
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
        <label className="block">
          <span className="text-sm text-ink-secondary">
            표시 이름 <span className="text-ink-muted">(선택)</span>
          </span>
          <Input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1"
            placeholder="비우면 이메일 앞부분이 사용됩니다"
            autoComplete="nickname"
            maxLength={40}
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
          {busy ? "가입 중…" : "다음 (사용 목적 입력)"}
        </Button>
      </form>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="container max-w-md py-16 text-ink-muted">로딩 중…</div>}>
      <SignupForm />
    </Suspense>
  );
}
