"use client";

/**
 * 세션 상단에 표시되는 시계 요소.
 * 라벨 작고, 숫자는 크고 뚜렷하게 (tabular-nums). 작은 화면에서도 가독성 유지.
 *
 * highlight=true 이면 warning 색상 — 체험 잔여 시간 경고 등에 사용.
 */
export function SessionClock({
  label,
  value,
  title,
  highlight = false,
}: {
  label: string;
  value: string;
  title?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="flex items-baseline gap-1.5"
      title={title}
    >
      <span className="text-xs uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      <span
        className={
          "font-mono tabular-nums text-base leading-none font-semibold " +
          (highlight ? "text-warning" : "text-ink-primary")
        }
      >
        {value}
      </span>
    </div>
  );
}
