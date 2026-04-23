"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Monitor, AlertCircle, Loader2, Ear } from "lucide-react";
import { NetworkStatus } from "@/components/shell/NetworkStatus";
import { LiveTranscript } from "@/components/session/LiveTranscript";
import { ControlBar } from "@/components/session/ControlBar";
import { ListenerSourcePicker } from "@/components/session/ListenerSourcePicker";
import { Badge } from "@/components/ui/badge";
import { SessionClock } from "@/components/session/SessionClock";
import { SessionExitModal } from "@/components/session/SessionExitModal";
import { ListenerConsentModal } from "@/components/listener/ConsentModal";
import { CorrectionModal } from "@/components/session/CorrectionModal";
import { useInterpretSession } from "@/hooks/useInterpretSession";
import {
  useNavigationGuard,
  type NavigationAttempt,
} from "@/hooks/useNavigationGuard";
import { formatDurationSec } from "@/lib/utils/time";

const LEGAL_VERSION = "2026-04-22";

/** 현재 session.state 를 한국어 뱃지 라벨로 변환. */
function stateLabel(state: string): string {
  switch (state) {
    case "live":
      return "청취 중";
    case "paused":
      return "일시정지";
    case "reconnecting":
      return "재연결 중";
    case "ended":
      return "종료됨";
    case "completed":
      return "완료";
    case "preflight":
    case "idle":
      return "연결 중…";
    default:
      return state.toUpperCase();
  }
}

function stateTone(
  state: string,
): "danger" | "info" | "warning" | "neutral" {
  if (state === "live") return "info"; // 청취 중이라 danger(빨강)보다 info(파랑)가 자연스러움
  if (state === "paused") return "warning";
  if (state === "reconnecting") return "warning";
  if (state === "ended" || state === "completed") return "neutral";
  return "neutral";
}

export default function ListenerPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const { id } = params;
  const [source, setSource] = useState<"mic" | "tab_audio">("mic");
  const [started, setStarted] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [pendingExit, setPendingExit] = useState<NavigationAttempt | null>(null);
  const [correctionSeq, setCorrectionSeq] = useState<number | null>(null);

  const session = useInterpretSession({
    sessionId: id,
    mode: "listener_live",
    qualityMode: "auto",
    audioSource: source,
  });

  const sessionDirty =
    started &&
    (session.state === "live" ||
      session.state === "paused" ||
      session.state === "reconnecting");
  useNavigationGuard({
    dirty: sessionDirty,
    onAttempt: (attempt) => setPendingExit(attempt),
  });

  async function logConsentAndStart() {
    // 상대방 동의 자기 확인을 consent_logs 에 기록한 뒤 세션 시작.
    try {
      await fetch("/api/account/consent", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kinds: ["listener_third_party"],
          version: LEGAL_VERSION,
          session_id: id,
        }),
      });
    } catch {
      // best-effort — 기록 실패가 세션 시작을 막지는 않음.
    }
    setConsentOpen(false);
    setStarted(true);
    try {
      await session.start();
    } catch {
      // start() 실패 시 pre-start 화면으로 되돌려 사용자가 재시도 버튼/권한을 다시 확인할 수 있도록.
      // (에러 배너는 session.lastErrorMessage 로 별도 렌더.)
      setStarted(false);
    }
  }

  // ── pre-start 화면 ──────────────────────────────────────────
  if (!started) {
    return (
      <div className="container max-w-2xl py-10 space-y-5">
        <div className="flex items-center gap-2">
          <Ear className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold">청취 시작</h1>
        </div>
        <p className="text-ink-secondary">
          현장 음성을 받아 실시간으로 번역합니다. 화자에게 재질문할 수 없는
          상황이므로, 신뢰도 낮은 구간은 <strong>검토 권장</strong>으로 표시됩니다.
        </p>
        {session.lastErrorMessage && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">시작에 실패했어요</p>
              <p className="mt-0.5 text-xs">{session.lastErrorMessage}</p>
            </div>
            <button
              type="button"
              onClick={session.clearLastError}
              className="shrink-0 rounded-md px-2 py-0.5 text-xs text-danger/80 hover:bg-danger/10"
            >
              닫기
            </button>
          </div>
        )}
        <ListenerSourcePicker value={source} onChange={setSource} />
        <div className="flex justify-end">
          <button
            className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-fg hover:bg-primary-hover"
            onClick={() => setConsentOpen(true)}
          >
            청취 시작
          </button>
        </div>
        <ListenerConsentModal
          open={consentOpen}
          recordingEnabled={false}
          onConfirm={logConsentAndStart}
          onCancel={() => setConsentOpen(false)}
        />
      </div>
    );
  }

  // ── running 화면 ────────────────────────────────────────────
  const isLive = session.state === "live";
  const isActiveOrWaiting =
    session.state === "live" || session.state === "paused";
  const hasItems = session.items.length > 0;
  const sourceIcon = source === "tab_audio" ? Monitor : Mic;
  const SourceIcon = sourceIcon;

  const emptyHint = (() => {
    if (session.state === "idle" || session.state === "preflight") {
      return (
        <span className="inline-flex flex-col items-center gap-1">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            게이트웨이 연결 중…
          </span>
          <span className="text-xs text-ink-muted">
            (상태: {session.state}) — 브라우저 DevTools 콘솔에서 [session] 로그를 확인해 주세요.
          </span>
        </span>
      );
    }
    if (session.state === "reconnecting") {
      return (
        <span className="inline-flex items-center gap-2 text-warning">
          <Loader2 className="h-4 w-4 animate-spin" />
          연결이 끊어졌어요. 다시 연결 중…
        </span>
      );
    }
    if (session.state === "paused") return "일시정지 상태입니다. 재개를 누르면 이어서 청취합니다.";
    if (session.state === "ended" || session.state === "completed")
      return "세션이 종료되었습니다.";
    // live && no items
    return (
      <span className="inline-flex flex-col items-center gap-2">
        <span className="inline-flex items-center gap-2 text-ink-secondary">
          <SourceIcon className="h-4 w-4" />
          {source === "tab_audio" ? "탭 오디오" : "마이크"} 연결됨 · 음성을 기다리는 중…
        </span>
        <span className="text-xs text-ink-muted">
          말씀을 시작하시면 원문과 번역이 여기 표시됩니다.
        </span>
      </span>
    );
  })();

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
      {/* 상단: 상태·시간·네트워크 */}
      <div className="sticky top-14 z-10 border-b border-border-subtle bg-canvas/90 backdrop-blur">
        <div className="container flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
          <Badge tone={stateTone(session.state)} dot={isLive}>
            {stateLabel(session.state)}
          </Badge>
          <NetworkStatus />
          <SessionClock
            label="세션"
            value={formatDurationSec(session.sessionElapsedSec)}
            title="세션이 시작된 뒤 흐른 전체 시간"
          />
          {session.trialConsumed != null && session.trialRemaining != null && (
            <>
              <SessionClock
                label="사용"
                value={formatDurationSec(session.trialConsumed)}
                title="실제 음성이 인식된 시간만 차감됩니다"
              />
              <SessionClock
                label="남은"
                value={formatDurationSec(session.trialRemaining)}
                highlight={session.trialRemaining <= 120}
                title="체험 잔여 시간"
              />
            </>
          )}
          <div className="ml-auto flex items-center gap-1.5 text-xs text-ink-muted">
            <SourceIcon className="h-3.5 w-3.5" />
            입력: {source === "tab_audio" ? "탭 오디오" : "마이크"}
          </div>
        </div>
      </div>

      {/* 에러 배너 */}
      {session.lastErrorMessage && (
        <div className="container mt-3">
          <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">
                {session.state === "ended" || session.state === "idle"
                  ? "청취를 이어갈 수 없어요"
                  : "연결이 불안정해요"}
              </p>
              <p className="mt-0.5 text-xs">{session.lastErrorMessage}</p>
              {(session.state === "ended" ||
                session.state === "idle" ||
                session.state === "preflight") && (
                <p className="mt-1 text-xs text-ink-secondary">
                  마이크/탭 오디오 권한을 확인한 뒤 다시 시도해 주세요.
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {(session.state === "ended" ||
                session.state === "idle" ||
                session.state === "preflight") && (
                <button
                  type="button"
                  onClick={() => {
                    void session.retry();
                  }}
                  className="rounded-md border border-danger/40 px-2 py-0.5 text-xs font-medium text-danger hover:bg-danger/10"
                >
                  다시 시도
                </button>
              )}
              <button
                type="button"
                onClick={session.clearLastError}
                className="rounded-md px-2 py-0.5 text-xs text-danger/80 hover:bg-danger/10"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* transcript 프레임 — 일반 통역 모드와 동일 스타일 */}
      <section className="container grid flex-1 gap-4 py-4 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col rounded-2xl border border-border-subtle bg-surface min-h-[60vh] overflow-hidden">
          <LiveTranscript
            items={session.items}
            onClarify={(seq) => {
              session.requestClarify(seq);
              setCorrectionSeq(seq);
            }}
            emptyHint={emptyHint}
          />
        </div>
        <aside className="space-y-3">
          <InfoCard
            label="현재 상태"
            value={stateLabel(session.state)}
            icon={<SourceIcon className="h-4 w-4 text-primary" />}
            sub={
              isActiveOrWaiting && hasItems
                ? `${session.items.length}개 발화 누적`
                : isLive
                ? "음성 대기 중"
                : undefined
            }
          />
          <InfoCard
            label="입력 소스"
            value={source === "tab_audio" ? "탭 오디오" : "마이크"}
            sub={
              source === "tab_audio"
                ? "Chrome/Edge 에서 오디오 포함 공유 필요"
                : "내장/외장 마이크"
            }
          />
          {session.rttLevel === "degraded" && (
            <InfoCard
              label="네트워크"
              value="저하됨"
              sub="인터넷 연결 품질이 낮아 지연이 있을 수 있습니다."
              warning
            />
          )}
        </aside>
      </section>

      <ControlBar
        state={session.state}
        micMuted={session.micMuted}
        onPause={session.pause}
        onResume={session.resume}
        onEnd={session.end}
        onToggleMic={session.toggleMic}
      />

      <CorrectionModal
        open={correctionSeq != null}
        item={
          correctionSeq != null
            ? session.items.find((x) => x.seq === correctionSeq) ?? null
            : null
        }
        onClose={() => setCorrectionSeq(null)}
        onSubmit={session.submitCorrection}
      />

      <SessionExitModal
        open={pendingExit != null}
        targetLabel={pendingExit?.href ?? undefined}
        onStay={() => setPendingExit(null)}
        onLeave={() => {
          const attempt = pendingExit;
          setPendingExit(null);
          try {
            session.end();
          } catch {
            /* noop */
          }
          if (attempt?.kind === "link" && attempt.href) {
            try {
              const url = new URL(attempt.href);
              if (url.origin === window.location.origin) {
                // typedRoutes 는 동적 문자열을 받지 않는다.
                router.push(
                  (url.pathname + url.search + url.hash) as never,
                );
              } else {
                window.location.href = attempt.href;
              }
            } catch {
              window.location.href = attempt.href;
            }
          } else if (attempt?.kind === "popstate") {
            window.history.back();
          }
        }}
      />
    </div>
  );
}

function InfoCard({
  label,
  value,
  sub,
  icon,
  warning = false,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  warning?: boolean;
}) {
  return (
    <div
      className={
        "rounded-2xl border bg-surface p-3 " +
        (warning
          ? "border-warning/40"
          : "border-border-subtle")
      }
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-ink-muted">
        {icon}
        <span>{label}</span>
      </div>
      <p
        className={
          "mt-1 text-base font-semibold " +
          (warning ? "text-warning" : "text-ink-primary")
        }
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}
