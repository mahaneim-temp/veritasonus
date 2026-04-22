"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NetworkStatus } from "@/components/shell/NetworkStatus";
import { LiveTranscript } from "@/components/session/LiveTranscript";
import { ControlBar } from "@/components/session/ControlBar";
import { PreflightCheck } from "@/components/session/PreflightCheck";
import { AssetUploader } from "@/components/assets/AssetUploader";
import { Badge } from "@/components/ui/badge";
import { useInterpretSession } from "@/hooks/useInterpretSession";
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

  const session = useInterpretSession({
    sessionId: id,
    mode: "interactive_interpretation",
    qualityMode: "auto",
  });

  if (!preflightOk) {
    return (
      <div className="container max-w-2xl py-10">
        <PreflightCheck
          onReady={async () => {
            setPreflightOk(true);
            await session.start();
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
        <div className="container flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
          <Badge
            tone={session.state === "live" ? "danger" : "neutral"}
            dot={session.state === "live"}
          >
            {stateLabel}
          </Badge>
          <NetworkStatus />
          <div
            className="flex items-baseline gap-1 text-xs text-ink-secondary"
            title="세션이 시작된 뒤 흐른 전체 시간"
          >
            <span className="text-ink-muted">세션</span>
            <span className="font-mono tabular-nums text-ink-primary">
              {formatDurationSec(session.sessionElapsedSec)}
            </span>
          </div>
          {session.trialRemaining != null && session.trialTotal != null && (
            <div
              className="flex items-baseline gap-1 text-xs"
              title="실제 음성이 인식된 시간만 차감됩니다 (무음·대기·일시정지 제외)"
            >
              <span className="text-ink-muted">체험 사용</span>
              <span
                className={`font-mono tabular-nums ${
                  session.trialRemaining <= 120 ? "text-warning" : "text-ink-primary"
                }`}
              >
                {formatDurationSec(
                  Math.max(0, session.trialTotal - session.trialRemaining),
                )}
              </span>
              <span className="text-ink-muted">
                / {formatDurationSec(session.trialTotal)}
              </span>
            </div>
          )}
          <div className="flex-1" />
          <label className="flex items-center gap-2 text-xs text-ink-secondary">
            <input
              type="checkbox"
              checked={showCorrected}
              onChange={(e) => setShowCorrected(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            보정문 보기
          </label>
        </div>
      </div>

      <section className="container grid flex-1 gap-4 py-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col rounded-2xl border border-border-subtle bg-surface min-h-[60vh]">
          <LiveTranscript
            items={session.items}
            onClarify={session.requestClarify}
            showCorrected={showCorrected}
          />
        </div>
        <aside className="space-y-4">
          <AssetUploader sessionId={id} />
          {session.lastError && (
            <div className="rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
              {session.lastError}
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
    </div>
  );
}
