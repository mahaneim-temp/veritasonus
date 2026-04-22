"use client";

import { Pause, Play, Square, Mic, MicOff, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionState } from "@/types/session";

export function ControlBar({
  state,
  micMuted,
  onPause,
  onResume,
  onEnd,
  onToggleMic,
  onAskHelp,
  assistAvailable,
}: {
  state: SessionState;
  micMuted: boolean;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
  onToggleMic: () => void;
  onAskHelp?: () => void;
  assistAvailable?: boolean;
}) {
  const isLive = state === "live";
  const isPaused = state === "paused";
  return (
    <div className="sticky bottom-0 z-20 border-t border-border-subtle bg-canvas/90 backdrop-blur px-4 py-3">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
        <Button
          variant="secondary"
          size="md"
          onClick={onToggleMic}
          aria-label="마이크 토글"
        >
          {micMuted ? (
            <MicOff className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
          {micMuted ? "음소거" : "수신 중"}
        </Button>

        <div className="flex items-center gap-2">
          {isLive ? (
            <Button variant="secondary" size="md" onClick={onPause}>
              <Pause className="h-4 w-4" /> 일시정지
            </Button>
          ) : (
            isPaused && (
              <Button variant="primary" size="md" onClick={onResume}>
                <Play className="h-4 w-4" /> 재개
              </Button>
            )
          )}
          <Button variant="destructive" size="md" onClick={onEnd}>
            <Square className="h-4 w-4" /> 종료
          </Button>
        </div>

        {assistAvailable && (
          <Button variant="ghost" size="md" onClick={onAskHelp}>
            <LifeBuoy className="h-4 w-4" /> 도움 요청
          </Button>
        )}
      </div>
    </div>
  );
}
