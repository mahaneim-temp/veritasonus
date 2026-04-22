"use client";

import { useEffect, useRef } from "react";
import { UtteranceRow } from "./UtteranceRow";
import type { UtteranceRow as U } from "@/types/session";

export function LiveTranscript({
  items,
  onClarify,
  showCorrected,
}: {
  items: U[];
  onClarify?: (seq: number) => void;
  showCorrected?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({
      top: ref.current.scrollHeight,
      behavior: "smooth",
    });
  }, [items.length]);

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-muted text-sm">
        음성이 감지되면 여기에 표시됩니다.
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      {items.map((it) => (
        <UtteranceRow
          key={it.seq}
          item={it}
          onClarify={onClarify}
          showCorrected={showCorrected}
        />
      ))}
    </div>
  );
}
