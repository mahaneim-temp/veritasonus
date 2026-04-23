"use client";

import { Suspense, useState } from "react";
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
import { LANGS } from "@/lib/constants/languages";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
} from "@/types/api";
import type { QualityMode, SessionMode } from "@/types/session";

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

// sub 는 모드의 설계 의도(왜 이렇게 동작하는지) 까지 짧게 전달한다.
function modeLabel(mode: SessionMode): {
  title: string;
  sub: string;
  icon: typeof Zap;
} {
  if (mode === "listener_live" || mode === "listener_live_recorded") {
    return {
      title: "청취 모드",
      sub: "자막처럼 따라가기 — 현장 발화를 실시간 번역 텍스트로만 보여주며, 문장이 화면에 충분히 머물도록 설계했습니다.",
      icon: Ear,
    };
  }
  if (mode === "assist_interpretation") {
    return {
      title: "통역 어시스트",
      sub: "대신 말해주지 않습니다 — 직접 말하려다 막히는 단어·표현만 제안해 '말하는 나'를 도와주는 방식입니다.",
      icon: HandHelping,
    };
  }
  return {
    title: "빠른 시작 (대화 모드)",
    sub: "짧게 끊어 바로 번역 — 대화의 호흡을 깨지 않도록 의도적으로 빠르게 반응합니다.",
    icon: Zap,
  };
}

export interface QuickStartDefaults {
  source: string | null;
  target: string | null;
  quality: QualityMode;
}

export default function QuickStartClient({
  defaults,
}: {
  defaults: QuickStartDefaults;
}) {
  return (
    <Suspense
      fallback={
        <div className="container max-w-3xl py-10 text-ink-muted">
          로딩 중…
        </div>
      }
    >
      <QuickStartInner defaults={defaults} />
    </Suspense>
  );
}

function QuickStartInner({ defaults }: { defaults: QuickStartDefaults }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode] = useState<SessionMode>(() =>
    modeFromQuery(searchParams.get("mode")),
  );
  const isListener = mode.startsWith("listener_");

  // 초기값 결정 규칙:
  //   1) listener 계열은 전통적으로 en→ko (듣는 사람 관점) — preferences 가 있으면 그걸 덮어씀.
  //   2) 온보딩에서 저장한 default_source/target 이 있으면 그것 사용.
  //   3) 없으면 ko→en (일반) 또는 en→ko (listener).
  const [source, setSource] = useState<string>(() => {
    if (defaults.source) return defaults.source;
    return isListener ? "en" : "ko";
  });
  const [target, setTarget] = useState<string>(() => {
    if (defaults.target) return defaults.target;
    return isListener ? "ko" : "en";
  });
  const [quality, setQuality] = useState<QualityMode>(defaults.quality);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const header = modeLabel(mode);
  const HeaderIcon = header.icon;

  // 온보딩에서 저장된 값이 있으면 상단에 안내 배너.
  const prefilled = !!(defaults.source || defaults.target);

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
      const created = await fetch("/api/sessions", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (created.status === 401) {
        router.push(`/login?next=/start/quick`);
        return;
      }
      const json = (await created.json()) as CreateSessionResponse | {
        error: { message: string };
      };
      if (!created.ok) throw new Error((json as any).error?.message);
      const sid = (json as CreateSessionResponse).session_id;
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

      {prefilled && (
        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          온보딩에서 저장한 기본값으로 채워두었습니다. 필요하면 바꿔주세요.
        </div>
      )}

      <Card className="mt-6">
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
