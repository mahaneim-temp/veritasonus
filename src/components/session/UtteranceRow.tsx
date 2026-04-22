"use client";

import { ConfidenceBadge } from "./ConfidenceBadge";
import { AlertTriangle } from "lucide-react";
import type { UtteranceRow as UtteranceType } from "@/types/session";
import { formatDurationSec } from "@/lib/utils/time";

interface Props {
  item: UtteranceType;
  onClarify?: (seq: number) => void;
  showCorrected?: boolean;
}

export function UtteranceRow({ item, onClarify, showCorrected }: Props) {
  const t = item.started_at_ms != null ? item.started_at_ms / 1000 : 0;
  return (
    <article
      className="rounded-2xl border border-border-subtle bg-surface p-4 md:p-5 hover:border-border-strong transition-colors"
      data-seq={item.seq}
    >
      <header className="flex items-center gap-2 text-xs text-ink-muted mb-2">
        <span className="font-mono">{formatDurationSec(t)}</span>
        {item.speaker_label && <span>· {item.speaker_label}</span>}
        <div className="flex-1" />
        <ConfidenceBadge level={item.confidence_level} />
        {item.requires_review && (
          <button
            onClick={() => onClarify?.(item.seq)}
            className="flex items-center gap-1 text-danger text-xs hover:underline"
            aria-label="재확인 요청"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            재확인
          </button>
        )}
      </header>
      <div className="grid gap-2 md:grid-cols-2">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-muted mb-1">
            원문
          </p>
          <p className="text-sm text-ink-primary leading-relaxed">
            {item.source_text}
          </p>
          {showCorrected && item.corrected_text && (
            <p className="mt-2 text-xs text-ink-secondary italic">
              ↳ {item.corrected_text}
            </p>
          )}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-muted mb-1">
            번역
          </p>
          <p className="text-sm text-ink-primary leading-relaxed">
            {item.translated_text ?? "…"}
          </p>
        </div>
      </div>
    </article>
  );
}
