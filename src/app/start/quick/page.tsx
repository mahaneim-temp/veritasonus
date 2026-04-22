"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRightLeft, Ear, HandHelping, Zap } from "lucide-react";
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
import type {
  CreateSessionRequest,
  CreateSessionResponse,
} from "@/types/api";
import type { QualityMode, SessionMode } from "@/types/session";

const LANGS = [
  { code: "ko", label: "한국어" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
];

const ALLOWED_MODES: readonly SessionMode[] = [
  "interactive_interpretation",
  "listener_live",
  "listener_live_recorded",
  "assist_interpretation",
];

function modeFromQuery(raw: string | null): SessionMode {
  if (raw && (ALLOWED_MODES as readonly string[]).includes(raw)) {
    return raw as SessionMode;
  }
  return "interactive_interpretation";
}

function modeLabel(mode: SessionMode): {
  title: string;
  sub: string;
  icon: typeof Zap;
} {
  if (mode === "listener_live" || mode === "listener_live_recorded") {
    return {
      title: "청취 모드",
      sub: "현장 발화를 받아 실시간으로 번역만 제공합니다.",
      icon: Ear,
    };
  }
  if (mode === "assist_interpretation") {
    return {
      title: "통역 어시스트",
      sub: "직접 말하려는데 막힐 때 단어·표현을 제안합니다.",
      icon: HandHelping,
    };
  }
  return {
    title: "빠른 시작",
    sub: "언어쌍과 품질 모드만 선택하고 즉시 시작합니다.",
    icon: Zap,
  };
}

export default function QuickStartPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // URL 의 ?mode 를 첫 렌더에 한 번 읽고 고정. 변경하고 싶으면 다른 세션 start 화면으로 재진입.
  const [mode] = useState<SessionMode>(() =>
    modeFromQuery(searchParams.get("mode")),
  );
  // listener 모드 기본값은 "영어 입력 → 한국어 자막" — 한국 사용자가 청취하는 가장 흔한 케이스.
  const [source, setSource] = useState(() =>
    mode.startsWith("listener_") ? "en" : "ko",
  );
  const [target, setTarget] = useState(() =>
    mode.startsWith("listener_") ? "ko" : "en",
  );
  const [quality, setQuality] = useState<QualityMode>("auto");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const header = modeLabel(mode);
  const HeaderIcon = header.icon;
  const isListener = mode.startsWith("listener_");

  function swap() {
    setSource(target);
    setTarget(source);
  }

  async function start() {
    setSubmitting(true);
    setErr(null);
    try {
      const body: CreateSessionRequest = {
        mode,
        source_lang: source,
        target_lang: target,
        quality_mode: quality,
      };
      // 쿠키에 guest 가 없으면 먼저 게스트 시작 (invite_code 미입력 상태에선 서버가 403 주면 /signup 안내)
      const created = await fetch("/api/sessions", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (created.status === 401) {
        const gr = await fetch("/api/auth/guest/start", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ user_agent: navigator.userAgent }),
        });
        if (!gr.ok) {
          const j = await gr.json();
          throw new Error(j?.error?.message ?? "guest_start_failed");
        }
        return start(); // retry
      }
      const json = (await created.json()) as CreateSessionResponse | {
        error: { message: string };
      };
      if (!created.ok) throw new Error((json as any).error?.message);
      const sid = (json as CreateSessionResponse).session_id;
      // 모드에 따라 전용 페이지로. typedRoutes 가 동적 문자열을 허용 안 해서 as never 로 단언.
      const dest = isListener
        ? `/session/${sid}/listener`
        : `/session/${sid}`;
      router.push(dest as never);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container max-w-3xl py-10 md:py-16">
      <div className="flex items-center gap-2 text-ink-primary">
        <HeaderIcon className="h-5 w-5 text-primary" />
        <h1 className="text-3xl font-semibold tracking-tight">{header.title}</h1>
      </div>
      <p className="mt-2 text-ink-secondary">{header.sub}</p>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>언어쌍</CardTitle>
          <CardDescription>
            {isListener
              ? "듣고자 하는 발화의 언어(입력)와, 자막으로 보고 싶은 언어(출력)를 선택하세요."
              : "음성이 들어오는 언어와, 번역이 나올 언어를 선택하세요."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          <LangPicker
            label={isListener ? "듣는 언어 (입력)" : "입력"}
            value={source}
            onChange={setSource}
          />
          <Button
            variant="ghost"
            size="md"
            onClick={swap}
            aria-label="언어쌍 바꾸기"
            className="mb-0.5"
          >
            <ArrowRightLeft className="h-4 w-4" />
          </Button>
          <LangPicker
            label={isListener ? "자막 언어 (출력)" : "출력"}
            value={target}
            onChange={setTarget}
          />
        </CardContent>
      </Card>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>품질 모드</CardTitle>
          <CardDescription>
            회선 상태와 정확성 요구에 맞게 선택하세요. 유료 플랜은 고품질 기본.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <QualityTile
            active={quality === "auto"}
            onClick={() => setQuality("auto")}
            title="자동"
            hint="네트워크에 맞춰 자동 전환 (권장)"
          />
          <QualityTile
            active={quality === "standard"}
            onClick={() => setQuality("standard")}
            title="일반"
            hint="지연이 가장 낮음"
          />
          <QualityTile
            active={quality === "premium"}
            onClick={() => setQuality("premium")}
            title="고품질"
            hint="숫자·날짜 재확인 강화"
          />
        </CardContent>
      </Card>

      {err && (
        <p className="mt-4 text-sm text-danger">오류: {err}</p>
      )}

      <div className="mt-8 flex items-center justify-between">
        <p className="text-xs text-ink-muted">
          다음 단계에서 프리플라이트(마이크·네트워크)가 자동 실행됩니다.
        </p>
        <Button size="lg" onClick={start} disabled={submitting}>
          <Zap className="h-5 w-5" />
          {submitting ? "세션 만드는 중…" : "시작"}
        </Button>
      </div>
    </div>
  );
}

function LangPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex-1">
      <label className="text-xs text-ink-muted">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="mt-1">
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
    </div>
  );
}

function QualityTile({
  active,
  onClick,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "text-left rounded-xl border p-4 transition-colors",
        active
          ? "border-primary bg-primary/5"
          : "border-border-subtle hover:border-border-strong",
      ].join(" ")}
    >
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-1 text-xs text-ink-muted leading-relaxed">{hint}</p>
    </button>
  );
}
