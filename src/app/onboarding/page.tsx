/**
 * /onboarding — 회원가입 Step 2.
 *
 * 필수값은 없고 전부 선택(스킵 가능)이다. 단, 채워주면 /start/quick 에서 반복 입력을
 * 없앨 수 있고 통역 품질(biasing 후보 선별)이 개선된다는 안내를 상단에 명시.
 *
 * 흐름:
 *   1) Step1(/signup) 성공 → 이 페이지 진입.
 *   2) "시작하기" 또는 "건너뛰기" → /onboarding/next 로.
 *   3) /onboarding/next 에서 모드 카드 3개 중 하나 선택 → /start/... 진입.
 */

"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LANGS } from "@/lib/constants/languages";
import { supabaseClient } from "@/lib/supabase/client";
import {
  PRIMARY_PURPOSE_LABELS,
  type PrimaryPurpose,
} from "@/types/user";
import type { QualityMode, SessionMode } from "@/types/session";
import { SESSION_MODE_LABELS } from "@/types/session";

const PURPOSE_OPTIONS = Object.entries(PRIMARY_PURPOSE_LABELS) as [
  PrimaryPurpose,
  string,
][];

const MODE_OPTIONS: SessionMode[] = [
  "interactive_interpretation",
  "listener_live",
  "assist_interpretation",
];

function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [displayName, setDisplayName] = useState("");
  const [purpose, setPurpose] = useState<PrimaryPurpose[]>([]);
  const [source, setSource] = useState<string>("ko");
  const [target, setTarget] = useState<string>("en");
  const [mode, setMode] = useState<SessionMode | "">("");
  const [quality, setQuality] = useState<QualityMode>("auto");
  const [domainInput, setDomainInput] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [wantsTerms, setWantsTerms] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 체험(/trial)에서 고른 언어쌍을 쿠키로 받았다면 기본값 선탑재.
  useEffect(() => {
    const raw =
      typeof document !== "undefined"
        ? document.cookie
            .split("; ")
            .find((r) => r.startsWith("trial_lang_pair="))
            ?.slice("trial_lang_pair=".length)
        : null;
    if (raw) {
      const [s, t] = decodeURIComponent(raw).split("-");
      if (s && t) {
        setSource(s);
        setTarget(t);
      }
    }
  }, []);

  // 현재 로그인한 사용자의 display_name 을 프리필(선택)
  useEffect(() => {
    (async () => {
      const { data } = await supabaseClient().auth.getUser();
      const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
      const dn =
        typeof meta.display_name === "string" ? meta.display_name : "";
      if (dn) setDisplayName(dn);
    })().catch(() => {});
  }, []);

  function togglePurpose(p: PrimaryPurpose) {
    setPurpose((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  }
  function addDomain() {
    const v = domainInput.trim();
    if (!v) return;
    if (domains.includes(v)) {
      setDomainInput("");
      return;
    }
    if (domains.length >= 10) return;
    setDomains((d) => [...d, v]);
    setDomainInput("");
  }
  function removeDomain(d: string) {
    setDomains((prev) => prev.filter((x) => x !== d));
  }

  async function submit(skip: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { skip };
      if (!skip) {
        body.display_name = displayName;
        body.primary_purpose = purpose;
        body.domain_tags = domains;
        body.default_source_lang = source;
        body.default_target_lang = target;
        body.preferred_mode = mode === "" ? null : mode;
        body.default_quality_mode = quality;
        body.wants_term_registration = wantsTerms;
      }
      const res = await fetch("/api/onboarding", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "저장 실패");
      router.push("/onboarding/next" as never);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "오류가 발생했습니다");
    } finally {
      setBusy(false);
    }
  }

  const inviteParam = searchParams.get("invite");

  return (
    <div className="container max-w-2xl py-10 md:py-16">
      <div className="flex items-center gap-2 text-primary">
        <Sparkles className="h-5 w-5" />
        <span className="text-xs uppercase tracking-widest font-medium">
          가입 2/2 단계
        </span>
      </div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        어떻게 사용하실 건가요?
      </h1>
      <p className="mt-2 text-ink-secondary">
        3개 항목만 알려주시면 통역 품질이 눈에 띄게 올라갑니다. 모두 나중에 설정에서 바꿀 수 있어요.
      </p>

      {/* Purpose */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>사용 목적 (중복 선택)</CardTitle>
          <CardDescription>
            주로 어떤 상황에서 쓰실 건가요?
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-3">
            {PURPOSE_OPTIONS.map(([k, label]) => {
              const on = purpose.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => togglePurpose(k)}
                  className={[
                    "rounded-xl border p-3 text-sm text-left transition-colors",
                    on
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border-subtle hover:border-border-strong",
                  ].join(" ")}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Languages */}
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>주로 쓰는 언어쌍</CardTitle>
          <CardDescription>
            /start/quick 기본값으로 씁니다. 세션마다 바꿀 수 있어요.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <LangField label="입력" value={source} onChange={setSource} />
          <LangField label="출력" value={target} onChange={setTarget} />
        </CardContent>
      </Card>

      {/* Mode (optional) */}
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>선호 모드 (선택)</CardTitle>
          <CardDescription>
            골라두면 앞으로 첫 화면이 바로 그 모드로 열립니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODE_OPTIONS.map((m) => {
              const on = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(on ? "" : m)}
                  className={[
                    "rounded-xl border p-3 text-sm text-left transition-colors",
                    on
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border-subtle hover:border-border-strong",
                  ].join(" ")}
                >
                  {SESSION_MODE_LABELS[m]}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Domain tags + display name + quality — advanced, optional */}
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>선택 입력</CardTitle>
          <CardDescription>
            다 비워도 됩니다. 적어두면 통역 맥락이 잡히는 데 도움이 됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block">
            <span className="text-xs text-ink-muted">표시 이름</span>
            <Input
              placeholder="세션 기록에 보일 이름 (비우면 이메일 앞부분 사용)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1"
              maxLength={40}
            />
          </label>

          <div>
            <div className="text-xs text-ink-muted">분야/도메인 태그</div>
            <div className="mt-1 flex gap-2">
              <Input
                placeholder="예: 스타트업, 의료, 교회"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addDomain();
                  }
                }}
                maxLength={40}
              />
              <Button type="button" variant="secondary" onClick={addDomain}>
                추가
              </Button>
            </div>
            {domains.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {domains.map((d) => (
                  <span
                    key={d}
                    className="inline-flex items-center gap-1 rounded-full bg-elev border border-border-subtle px-2.5 py-1 text-xs"
                  >
                    {d}
                    <button
                      type="button"
                      onClick={() => removeDomain(d)}
                      aria-label={`${d} 제거`}
                      className="text-ink-muted hover:text-ink-primary"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <label className="block">
            <span className="text-xs text-ink-muted">기본 품질 모드</span>
            <Select
              value={quality}
              onValueChange={(v) => setQuality(v as QualityMode)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">자동 (권장)</SelectItem>
                <SelectItem value="standard">일반 (지연 낮음)</SelectItem>
                <SelectItem value="premium">고품질 (재확인 강화)</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={wantsTerms}
              onChange={(e) => setWantsTerms(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              용어집/자료 미리 등록 기능이 나오면 알려주세요.
              <span className="block text-xs text-ink-muted">
                (v1.1 예정. 지금은 신청만 받습니다.)
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      {err && <p className="mt-4 text-sm text-danger">{err}</p>}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={busy}
          className="text-sm text-ink-muted underline-offset-2 hover:underline disabled:opacity-50"
        >
          건너뛰기 (나중에 설정에서 입력)
        </button>
        <Button
          size="lg"
          onClick={() => submit(false)}
          disabled={busy}
          className="sm:min-w-40"
        >
          {busy ? "저장 중…" : "저장하고 계속"}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      <p className="mt-6 text-xs text-ink-muted">
        입력한 정보는 통역 품질 향상(맥락 반영) 과 첫 화면 프리필 용도로만 사용되며, 언제든{" "}
        <Link href={"/account" as never} className="underline">
          내 설정
        </Link>
        에서 변경할 수 있습니다.
        {inviteParam ? ` (초대코드: ${inviteParam})` : ""}
      </p>
    </div>
  );
}

function LangField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs text-ink-muted">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LANGS.map((l) => (
            <SelectItem key={l.code} value={l.code}>
              {l.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="container max-w-2xl py-16 text-ink-muted">로딩 중…</div>
      }
    >
      <OnboardingInner />
    </Suspense>
  );
}
