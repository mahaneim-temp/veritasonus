"use client";

import { use, useState } from "react";
import { NetworkStatus } from "@/components/shell/NetworkStatus";
import { LiveTranscript } from "@/components/session/LiveTranscript";
import { ControlBar } from "@/components/session/ControlBar";
import { ListenerSourcePicker } from "@/components/session/ListenerSourcePicker";
import { Badge } from "@/components/ui/badge";
import { useInterpretSession } from "@/hooks/useInterpretSession";

export default function ListenerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [source, setSource] = useState<"mic" | "tab_audio">("mic");
  const [started, setStarted] = useState(false);

  const session = useInterpretSession({
    sessionId: id,
    mode: "listener_live",
    qualityMode: "auto",
    audioSource: source,
  });

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
            onClick={async () => {
              setStarted(true);
              await session.start();
            }}
          >
            청취 시작
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
      <div className="sticky top-14 z-10 border-b border-border-subtle bg-canvas/90 backdrop-blur">
        <div className="container flex items-center gap-3 py-2.5">
          <Badge tone="info" dot>
            청취 중
          </Badge>
          <NetworkStatus />
          <div className="text-xs text-ink-muted">
            주제: <span className="text-ink-primary">추정 중…</span>
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
    </div>
  );
}
