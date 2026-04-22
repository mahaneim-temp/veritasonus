"use client";

import { Button } from "@/components/ui/button";

/**
 * 세션 이탈 확인 모달.
 *
 * - onStay  : 현재 세션 유지 (계속 통역)
 * - onLeave : 세션을 정리하고 이동
 */
export function SessionExitModal(props: {
  open: boolean;
  targetLabel?: string; // "다른 페이지" / URL 등
  onStay: () => void;
  onLeave: () => void | Promise<void>;
}) {
  if (!props.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-exit-title"
      onClick={(e) => {
        // 배경 클릭은 취소(계속 통역) 로 해석. 실수로 나가는 것보다 안전한 방향.
        if (e.target === e.currentTarget) props.onStay();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
        <h2 id="session-exit-title" className="text-lg font-semibold">
          통역 세션을 종료하고 이동하시겠습니까?
        </h2>
        <p className="mt-2 text-sm text-ink-secondary">
          현재 대화 내용이 저장되지 않을 수 있습니다. 이동하면 세션이 종료됩니다.
        </p>
        {props.targetLabel && (
          <p className="mt-1 text-xs text-ink-muted truncate">
            이동 대상: {props.targetLabel}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={props.onStay}>
            계속 통역
          </Button>
          <Button variant="destructive" onClick={() => void props.onLeave()}>
            종료 후 이동
          </Button>
        </div>
      </div>
    </div>
  );
}
