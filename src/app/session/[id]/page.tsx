"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { NetworkStatus } from "@/components/shell/NetworkStatus";
import { LiveTranscript } from "@/components/session/LiveTranscript";
import { ControlBar } from "@/components/session/ControlBar";
import { PreflightCheck } from "@/components/session/PreflightCheck";
import { AssetUploader } from "@/components/assets/AssetUploader";
import { Badge } from "@/components/ui/badge";
import { useInterpretSession } from "@/hooks/useInterpretSession";

/**
 * 실시간 통역 화면.
 * - 상단: 상태 점, 트라이얼 잔여, 네트워크, 녹음 여부
 * - 본문: LiveTranscript
 * - 하단: ControlBar
 */
export default function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { id } = use(params);
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
        <div className="container flex items-center gap-3 py-2.5">
          <Badge
            tone={session.state === "live" ? "danger" : "neutral"}
            dot={session.state === "live"}
          >
            {stateLabel}
          </Badge>
          <NetworkStatus />
          {session.trialRemaining != null && (
            <Badge tone={session.trialRemaining <= 120 ? "warning" : "info"}>
              체험 {Math.max(0, session.trialRemaining)}초
            </Badge>
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
