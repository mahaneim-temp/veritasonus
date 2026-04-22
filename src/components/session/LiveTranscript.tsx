"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { UtteranceRow } from "./UtteranceRow";
import type { UtteranceRow as U } from "@/types/session";

/** 사용자가 맨 아래 근처에 있는지 판정하는 임계값(px). */
const STICK_THRESHOLD_PX = 80;

export function LiveTranscript({
  items,
  onClarify,
  showCorrected,
  emptyHint,
}: {
  items: U[];
  onClarify?: (seq: number) => void;
  showCorrected?: boolean;
  /** items 가 비었을 때 가운데 표시할 안내 문구. 전달 안 하면 기본값. */
  emptyHint?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [hasUnread, setHasUnread] = useState(false);

  /** 현재 스크롤이 맨 아래 근처인지 계산. */
  function atBottom(el: HTMLDivElement): boolean {
    return el.scrollHeight - (el.scrollTop + el.clientHeight) <= STICK_THRESHOLD_PX;
  }

  // 사용자 스크롤 추적 — 위로 올리면 따라가기 해제, 다시 내려가면 재활성.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (atBottom(el)) {
          setStickToBottom(true);
          setHasUnread(false);
        } else {
          setStickToBottom(false);
        }
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  // 아이템 추가/변경 시 스크롤 처리.
  // items.length 뿐 아니라 마지막 item 의 source/translated_text 도 감지 키에 포함 —
  // partial 업데이트(텍스트만 변하고 개수는 그대로)도 놓치지 않는다.
  const last = items[items.length - 1];
  const changeKey = `${items.length}|${last?.seq ?? ""}|${last?.source_text ?? ""}|${last?.translated_text ?? ""}`;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (stickToBottom) {
      // smooth 대신 즉시 — 연속 업데이트 시 애니메이션이 따라오지 못해 중간에 멈추는 문제 방지.
      el.scrollTop = el.scrollHeight;
      setHasUnread(false);
    } else {
      // 사용자가 위에 있으면 "새 발화 있음" 뱃지만 표시.
      setHasUnread(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeKey]);

  function jumpToLatest() {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setStickToBottom(true);
    setHasUnread(false);
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-muted text-sm px-4 text-center">
        {emptyHint ?? "음성이 감지되면 여기에 표시됩니다."}
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={ref}
        className="absolute inset-0 overflow-y-auto px-4 md:px-6 py-4 space-y-3 overscroll-contain"
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
      {!stickToBottom && hasUnread && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-fg shadow-lg hover:bg-primary-hover"
          aria-label="최신 발화로 이동"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          최신 발화
        </button>
      )}
    </div>
  );
}
