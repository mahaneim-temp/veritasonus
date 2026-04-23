"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { NetworkStatus } from "@/components/shell/NetworkStatus";
import { LiveTranscript } from "@/components/session/LiveTranscript";
import { ControlBar } from "@/components/session/ControlBar";
import { PreflightCheck } from "@/components/session/PreflightCheck";
import { AssetUploader } from "@/components/assets/AssetUploader";
import { Badge } from "@/components/ui/badge";
import { SessionClock } from "@/components/session/SessionClock";
import { SessionExitModal } from "@/components/session/SessionExitModal";
import { CorrectionModal } from "@/components/session/CorrectionModal";
import { useInterpretSession } from "@/hooks/useInterpretSession";
import {
  useNavigationGuard,
  type NavigationAttempt,
} from "@/hooks/useNavigationGuard";
import { formatDurationSec } from "@/lib/utils/time";

/**
 * 실시간 통역 화면.
 * - 상단: 상태 점, 트라이얼 잔여, 네트워크, 녹음 여부
 * - 본문: LiveTranscript
 * - 하단: ControlBar
 */
export default function SessionPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const { id } = params;
  const [preflightOk, setPreflightOk] = useState(false);
  const [showCorrected, setShowCorrected] = useState(false);
  const [pendingExit, setPendingExit] = useState<NavigationAttempt | null>(null);
  const [correctionSeq, setCorrectionSeq] = useState<number | null>(null);

  const session = useInterpretSession({
    sessionId: id,
    mode: "interactive_interpretation",
    qualityMode: "auto",
  });

  // 진행 중(live/paused/reconnecting) 세션에서만 가드 활성.
  const sessionDirty =
    session.state === "live" ||
    session.state === "paused" ||
    session.state === "reconnecting";
  useNavigationGuard({
    dirty: sessionDirty,
    onAttempt: (attempt) => setPendingExit(attempt),
  });

  if (!preflightOk) {
    return (
      <div className="container max-w-2xl py-10 space-y-5">
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
        <PreflightCheck
          onReady={async () => {
            setPreflightOk(true);
            try {
              await session.start();
            } catch {
              // start() 실패 시 PreflightCheck 화면으로 돌려 재시도 가능하게.
              setPreflightOk(false);
            }
          }}
        />
      </div>
    );
  }

  const stateLabel =
    session.state === "live"
      ? "LIVE"
      : session.state === "paused"
      ? "일시정지"
      : session.state === "ended"
      ? "종료됨"
      : session.state.toUpperCase();

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
      <div className="sticky top-14 z-10 border-b border-border-subtle bg-canvas/90 backdrop-blur">
        <div className="container flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
          <Badge
            tone={session.state === "live" ? "danger" : "neutral"}
            dot={session.state === "live"}
          >
            {stateLabel}
          </Badge>
          <NetworkStatus />
          <SessionClock
            label="세션"
            value={formatDurationSec(session.sessionElapsedSec)}
            title="세션이 시작된 뒤 흐른 전체 시간 (일시정지 포함)"
          />
          {session.trialConsumed != null && session.trialRemaining != null && (
            <>
              <SessionClock
                label="사용"
                value={formatDurationSec(session.trialConsumed)}
                title="실제 음성이 인식된 시간만 차감됩니다 (무음·대기·일시정지 제외)"
              />
              <SessionClock
                label="남은"
                value={formatDurationSec(session.trialRemaining)}
                highlight={session.trialRemaining <= 120}
                title="체험 잔여 시간 — 사용 + 남은 = 전체 체험"
              />
            </>
          )}
          <div className="flex-1" />
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            <input
              type="checkbox"
              checked={showCorrected}
              onChange={(e) => setShowCorrected(e.target.checked)}
              className="h-4 w-4"
            />
            보정문 보기
          </label>
        </div>
      </div>

      <section className="container grid flex-1 gap-4 py-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col rounded-2xl border border-border-subtle bg-surface min-h-[60vh]">
          <LiveTranscript
            items={session.items}
            onClarify={(seq) => {
              session.requestClarify(seq);
              setCorrectionSeq(seq);
            }}
            showCorrected={showCorrected}
          />
        </div>
        <aside className="space-y-4">
          <AssetUploader sessionId={id} />
          {session.lastErrorMessage && (
            <div className="flex items-start gap-2 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">
                  {session.state === "ended"
                    ? "세션을 이어갈 수 없어요"
                    : "연결이 불안정해요"}
                </p>
                <p className="mt-0.5 text-xs">{session.lastErrorMessage}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {session.state === "ended" && (
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
          )}
        </aside>
      </section>

      <ControlBar
        state={session.state}
        micMuted={session.micMuted}
        onPause={session.pause}
        onResume={session.resume}
        onEnd={() => {
          session.end();
          router.push(`/session/${id}/review`);
        }}
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
            // 같은 origin 이면 SPA 네비게이션, 외부 링크면 full reload.
            try {
              const url = new URL(attempt.href);
              if (url.origin === window.location.origin) {
                // typedRoutes 는 동적 문자열을 받지 않는다. 런타임 이동 경로라 cast 불가피.
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
            // 이 시점에는 이미 push 로 막은 상태. 한 번 더 뒤로가기.
            window.history.back();
          }
          // beforeunload 케이스는 브라우저가 이미 모달을 띄우고 처리.
        }}
      />
    </div>
  );
}
