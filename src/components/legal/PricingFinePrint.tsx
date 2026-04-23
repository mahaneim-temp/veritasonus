/**
 * 충전 요금 관련 법정 fine-print. /pricing, 결제 모달, /signup 에서 재사용.
 */
export function PricingFinePrint({ className = "" }: { className?: string }) {
  return (
    <ul
      className={`text-xs text-ink-muted space-y-1 list-disc list-inside ${className}`}
      aria-label="충전 정책 안내"
    >
      <li>무료 10분은 매달 초기화되며 이월되지 않습니다.</li>
      <li>유료 팩 구매 시 이번 달 남아 있는 무료 시간은 충전 시간으로 이관되어 만료 없이 유지됩니다.</li>
      <li>충전 시간(구매분)은 v1 기준 만료가 없습니다.</li>
      <li>
        현재 가격·분수는 <strong className="text-ink-secondary">가정값</strong>이며, 원가
        실측 후 변경될 수 있습니다. 변경 시 결제 전 고지합니다.
      </li>
      <li>
        환불은{" "}
        <a href="/legal/refund" className="underline" target="_blank" rel="noopener noreferrer">
          환불 정책
        </a>
        에 따릅니다 (구매 후 7일 이내 미사용분 전액 / 일부 사용 시 차감 환불).
      </li>
    </ul>
  );
}
