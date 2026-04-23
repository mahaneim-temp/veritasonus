/**
 * /trial — 1분 맛보기 체험 랜딩.
 * 비회원도 접근 가능 (middleware 예외). 로그인 사용자에게는 안내 배너 표시.
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Zap, Info, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabaseClient } from "@/lib/supabase/client";
import { LANGS } from "@/lib/constants/languages";

export default function TrialLandingPage() {
  const router = useRouter();
  const [source, setSource] = useState("ko");
  const [target, setTarget] = useState("en");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 체험에서 고른 언어쌍을 24h 쿠키로 남겨둔다. 가입(/signup → /onboarding) 화면이 읽어서 프리필.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const pair = `${source}-${target}`;
    const oneDay = 60 * 60 * 24;
    document.cookie = `trial_lang_pair=${encodeURIComponent(pair)}; max-age=${oneDay}; path=/; samesite=lax`;
  }, [source, target]);

  async function startTaste() {
    setBusy(true);
    setErr(null);
    try {
      // 1. 게스트 시작 (mode=taste → 60초 Redis TTL)
      const gr = await fetch("/api/auth/guest/start", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "taste", user_agent: navigator.userAgent }),
      });
      if (!gr.ok) {
        const j = await gr.json();
        throw new Error(j?.error?.message ?? "guest_start_failed");
      }

      // 2. 세션 생성 (guest cookie 이제 셋)
      const sr = await fetch("/api/sessions", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "interactive_interpretation",
          source_lang: source,
          target_lang: target,
          quality_mode: "standard",
        }),
      });
      const sj = await sr.json();
      if (!sr.ok) throw new Error(sj?.error?.message ?? "session_create_failed");

      // 3. 맛보기 전용 세션 페이지로
      router.push(`/trial/live?sid=${sj.session_id}&src=${source}&tgt=${target}` as never);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "오류가 발생했습니다");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container max-w-2xl py-10 md:py-16">
      {/* Header */}
      <div className="flex items-center gap-2 text-primary">
        <Zap className="h-5 w-5" />
        <span className="text-xs uppercase tracking-widest font-medium">1분 맛보기</span>
      </div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-primary">
        가입 없이 통역을 경험해 보세요
      </h1>
      <p className="mt-2 text-ink-secondary">
        1분 동안 실제 AI 통역 성능을 체험할 수 있습니다.
        기록은 저장되지 않으며, 체험 후 회원가입으로 이어갈 수 있습니다.
      </p>

      {/* Info chips */}
      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        {["⏱ 1분 제한", "💾 기록 저장 없음", "🔒 가입 불필요", "🎯 실제 AI 통역"].map((t) => (
          <span key={t} className="rounded-full border border-border-subtle bg-elev px-3 py-1 text-ink-secondary">
            {t}
          </span>
        ))}
      </div>

      {/* Language picker */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>언어 설정</CardTitle>
          <CardDescription>어떤 언어를 통역할까요?</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <p className="text-xs text-ink-muted mb-1">입력 언어</p>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGS.map((l) => (
                    <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ArrowRight className="h-4 w-4 text-ink-muted mt-5 shrink-0" />
            <div className="flex-1">
              <p className="text-xs text-ink-muted mb-1">출력 언어</p>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGS.map((l) => (
                    <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {err && <p className="mt-3 text-sm text-danger">{err}</p>}

      <div className="mt-6 flex flex-col sm:flex-row gap-3">
        <Button size="lg" onClick={startTaste} disabled={busy} className="sm:flex-1">
          <Zap className="h-5 w-5" />
          {busy ? "준비 중…" : "1분 체험 시작"}
        </Button>
        <Link href={"/signup" as never} className="sm:flex-1">
          <Button size="lg" variant="secondary" className="w-full">
            바로 회원가입 (월 10분 무료)
          </Button>
        </Link>
      </div>

      <p className="mt-4 text-xs text-ink-muted text-center">
        회원으로 가입하면 매달 10분 무료 + 추가 충전 시 무제한 사용 가능합니다.
      </p>
    </div>
  );
}
