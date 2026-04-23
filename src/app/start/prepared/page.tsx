"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SessionMode, QualityMode } from "@/types/session";
import { SESSION_MODE_LABELS } from "@/types/session";
import type { CreateSessionRequest } from "@/types/api";
import { LANGS } from "@/lib/constants/languages";

const STEPS = [
  "사용 형태",
  "언어 설정",
  "상황 설명",
  "대상/격식",
  "원고/자료",
  "정확성 우선",
  "녹음/사후정제",
] as const;

export default function PreparedStartPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<
    Omit<CreateSessionRequest, "mode"> & {
      mode: SessionMode;
      audience?: string;
      context_note?: string;
      recording_enabled: boolean;
      precision_focus: string[];
    }
  >({
    mode: "interactive_interpretation",
    source_lang: "ko",
    target_lang: "en",
    quality_mode: "premium",
    audience: "",
    context_note: "",
    recording_enabled: false,
    precision_focus: [],
  });

  async function submit() {
    const res = await fetch("/api/sessions", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: state.mode,
        source_lang: state.source_lang,
        target_lang: state.target_lang,
        quality_mode: state.quality_mode,
        audience: state.audience,
        context_note: state.context_note,
        recording_enabled: state.recording_enabled,
      } satisfies CreateSessionRequest),
    });
    const json = await res.json();
    if (res.status === 401) {
      router.push("/login?next=/start/prepared");
      return;
    }
    if (!res.ok) {
      alert(json?.error?.message ?? "세션 생성 실패");
      return;
    }
    // mode 따라 전용 페이지로. listener 계열은 listener route, 그 외는 기본 route.
    const isListener = state.mode.startsWith("listener_");
    const dest = isListener
      ? `/session/${json.session_id}/listener`
      : `/session/${json.session_id}?from=prepared`;
    router.push(dest as never);
  }

  return (
    <div className="container max-w-4xl py-10 md:py-16">
      <h1 className="text-3xl font-semibold tracking-tight">준비하고 시작</h1>
      <p className="mt-2 text-ink-secondary">
        미리 알려주시면 통역 품질이 더 좋아집니다.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-[220px_1fr]">
        <aside className="space-y-1">
          {STEPS.map((label, i) => (
            <button
              key={label}
              onClick={() => setStep(i)}
              className={[
                "w-full text-left rounded-lg px-3 py-2 text-sm transition-colors",
                i === step
                  ? "bg-primary/10 text-primary font-medium"
                  : "hover:bg-elev text-ink-secondary",
              ].join(" ")}
            >
              {i + 1}. {label}
            </button>
          ))}
        </aside>

        <Card>
          <CardHeader>
            <CardTitle>{STEPS[step]}</CardTitle>
            <CardDescription>{HINTS[step]}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === 0 && (
              <ModePick
                value={state.mode}
                onChange={(m) => setState((s) => ({ ...s, mode: m }))}
              />
            )}
            {step === 1 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <LangField
                  label="입력 언어"
                  value={state.source_lang}
                  onChange={(v) => setState((s) => ({ ...s, source_lang: v }))}
                />
                <LangField
                  label="출력 언어"
                  value={state.target_lang}
                  onChange={(v) => setState((s) => ({ ...s, target_lang: v }))}
                />
              </div>
            )}
            {step === 2 && (
              <textarea
                className="w-full min-h-[140px] rounded-xl border border-border-strong bg-surface p-3 text-sm"
                placeholder="예: 외국인 환자의 내과 진료 동행. 증상 청취 중심."
                value={state.context_note}
                onChange={(e) =>
                  setState((s) => ({ ...s, context_note: e.target.value }))
                }
              />
            )}
            {step === 3 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs text-ink-muted">대상/청중</span>
                  <Input
                    placeholder="예: 의사, 청중, 상사, 고객"
                    value={state.audience ?? ""}
                    onChange={(e) =>
                      setState((s) => ({ ...s, audience: e.target.value }))
                    }
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-ink-muted">격식 수준</span>
                  <Select
                    defaultValue="formal"
                    onValueChange={(v) =>
                      setState((s) => ({ ...s, context_note: `${s.context_note} [격식: ${v}]` }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="formal">정중(존대)</SelectItem>
                      <SelectItem value="neutral">중간</SelectItem>
                      <SelectItem value="casual">친근</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>
            )}
            {step === 4 && (
              <p className="text-sm text-ink-secondary">
                세션이 만들어진 다음 단계에서 원고/슬라이드/용어집을 업로드합니다.
              </p>
            )}
            {step === 5 && (
              <PrecisionPicker
                value={state.precision_focus}
                onChange={(v) =>
                  setState((s) => ({ ...s, precision_focus: v }))
                }
              />
            )}
            {step === 6 && (
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={state.recording_enabled}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      recording_enabled: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded border-border-strong"
                />
                <span>
                  <span className="text-sm">녹음 병행</span>
                  <span className="block text-xs text-ink-muted">
                    종료 후 사후 복원본을 더 풍부하게 생성합니다.
                  </span>
                </span>
              </label>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="ghost"
                disabled={step === 0}
                onClick={() => setStep((s) => s - 1)}
              >
                이전
              </Button>
              {step < STEPS.length - 1 ? (
                <Button onClick={() => setStep((s) => s + 1)}>다음</Button>
              ) : (
                <Button onClick={submit}>검토하고 시작</Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const HINTS: string[] = [
  "통역 중심인지, 청취 중심인지, 보조 도움인지 알려주세요.",
  "입력/출력 언어와 자동 감지 여부.",
  "회의·설교·발표·병원·여행·행정 등 상황을 한두 문장으로.",
  "누구를 대상으로 말하나요? 격식 수준은?",
  "원고·슬라이드·용어집이 있으면 다음 화면에서 올릴 수 있습니다.",
  "숫자·날짜·단위·가격 등 중요 항목을 체크하세요.",
  "녹음을 함께 받으면 사후 복원본이 풍부해집니다.",
];

function ModePick({
  value,
  onChange,
}: {
  value: SessionMode;
  onChange: (v: SessionMode) => void;
}) {
  const options: SessionMode[] = [
    "interactive_interpretation",
    "listener_live",
    "listener_live_recorded",
    "assist_interpretation",
  ];
  return (
    <div className="grid gap-2">
      {options.map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={[
            "text-left rounded-xl border p-3 transition-colors",
            value === m
              ? "border-primary bg-primary/5"
              : "border-border-subtle hover:border-border-strong",
          ].join(" ")}
        >
          <div className="font-medium text-sm">{SESSION_MODE_LABELS[m]}</div>
          <div className="text-xs text-ink-muted mt-0.5">
            {m === "interactive_interpretation" &&
              "내가 말하는 내용을 상대 언어로 정확히 전달합니다."}
            {m === "listener_live" &&
              "화자는 앱을 쓰지 않고, 나만 실시간으로 이해합니다."}
            {m === "listener_live_recorded" &&
              "Listener + 녹음. 끝난 후 사후 복원본 생성 가능."}
            {m === "assist_interpretation" &&
              "직접 말하려 하다 막히는 부분만 도와줍니다."}
          </div>
        </button>
      ))}
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

const FOCUS_ITEMS = [
  { id: "number", label: "숫자/수량" },
  { id: "date", label: "날짜/시각" },
  { id: "money", label: "가격/금액" },
  { id: "medical", label: "의료 용어/증상" },
  { id: "legal", label: "계약 조건" },
  { id: "safety", label: "안전 지시" },
];

function PrecisionPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(
      value.includes(id) ? value.filter((x) => x !== id) : [...value, id],
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {FOCUS_ITEMS.map((it) => (
        <button
          key={it.id}
          onClick={() => toggle(it.id)}
          className={[
            "rounded-xl border p-3 text-sm transition-colors",
            value.includes(it.id)
              ? "border-primary bg-primary/5 text-primary"
              : "border-border-subtle hover:border-border-strong",
          ].join(" ")}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
