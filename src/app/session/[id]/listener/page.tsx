"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NetworkStatus } from "@/components/shell/NetworkStatus";
import { LiveTranscript } from "@/components/session/LiveTranscript";
import { ControlBar } from "@/components/session/ControlBar";
import { ListenerSourcePicker } from "@/components/session/ListenerSourcePicker";
import { Badge } from "@/components/ui/badge";
import { SessionClock } from "@/components/session/SessionClock";
import { SessionExitModal } from "@/components/session/SessionExitModal";
import { ListenerConsentModal } from "@/components/listener/ConsentModal";
import { useInterpretSession } from "@/hooks/useInterpretSession";
import {
  useNavigationGuard,
  type NavigationAttempt,
} from "@/hooks/useNavigationGuard";
import { formatDurationSec } from "@/lib/utils/time";

const LEGAL_VERSION = "2026-04-22";

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
    await session.start();
  }

  if (!started) {
    return (
      <div className="container max-w-2xl py-10 space-y-5">
        <h1 className="text-2xl font-semibold">청취 시작</h1>
        <p className="text-ink-secondary">
          현장 음성을 받아 실시간으로 번역합니다. 화자에게 재질문할 수 없는
          상황이므로, 신뢰도 낮은 구간은 <strong>검토 권장</strong>으로 표시됩니다.
        </p>
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

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
      <div className="sticky top-14 z-10 border-b border-border-subtle bg-canvas/90 backdrop-blur">
        <div className="container flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
          <Badge tone="info" dot>
            청취 중
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
          <div className="ml-auto text-sm text-ink-muted">
            주제 <span className="text-ink-primary">추정 중…</span>
          </div>
        </div>
      </div>
      <div className="flex-1 rounded-2xl border border-border-subtle bg-surface container my-4 min-h-[60vh]">
        <LiveTranscript items={session.items} />
      </div>
      <ControlBar
        state={session.state}
        micMuted={session.micMuted}
        onPause={session.pause}
        onResume={session.resume}
        onEnd={session.end}
        onToggleMic={session.toggleMic}
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
