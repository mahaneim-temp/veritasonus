/**
 * /legal/refund — 환불 정책 (전자상거래법 / PG 심사 요건).
 */

export const metadata = { title: "환불 정책" };

export default function RefundPolicyPage() {
  return (
    <article className="container max-w-3xl py-12 prose prose-sm">
      <h1>환불 정책</h1>
      <p className="text-xs text-ink-muted">버전: 2026-04-23 (초안 — 배포 전 검토 필요)</p>

      <h2>1. 환불 대상</h2>
      <p>
        Lucid Interpret 서비스에서 구매한 충전 팩(시간 크레딧)에 한합니다.
        관리자가 지급한 무료 크레딧은 환불 대상이 아닙니다.
      </p>

      <h2>2. 환불 조건</h2>
      <ul>
        <li>
          <strong>전액 환불</strong>: 구매 후 7일 이내이며, 충전분을 전혀 사용하지 않은 경우.
        </li>
        <li>
          <strong>부분 환불</strong>: 구매 후 7일 이내이며, 충전분 일부를 사용한 경우 —
          사용한 시간에 해당하는 금액을 차감한 나머지를 환불합니다.
          사용 시간 단가는 구매한 팩의 분당 단가를 기준으로 계산하며, 보너스 시간은
          환불 계산에서 선사용으로 간주합니다.
        </li>
        <li>
          <strong>예외</strong>: 서비스 하자, 표시·광고와 다른 내용 제공 등 사업자 귀책 사유가 있는 경우
          전자상거래법에 따른 소비자 보호 원칙을 우선 적용합니다.
        </li>
      </ul>

      <h2>3. 환불 불가 조건</h2>
      <ul>
        <li>구매 후 7일이 경과한 경우.</li>
        <li>충전분을 100% 소진한 경우.</li>
        <li>서비스 약관 위반으로 계정이 제한된 경우.</li>
      </ul>

      <h2>4. 환불 신청 방법</h2>
      <p>
        고객센터 이메일(<a href="mailto:support@lucid-interpret.app">support@lucid-interpret.app</a>)로
        아래 내용을 포함하여 신청하세요.
      </p>
      <ul>
        <li>가입 이메일</li>
        <li>구매 일시 및 팩 종류</li>
        <li>환불 사유</li>
      </ul>
      <p>영업일 기준 3일 이내 검토 후 답변 드립니다.</p>

      <h2>5. 환불 처리 기간</h2>
      <p>
        환불 승인 후 결제 수단에 따라 3~5 영업일 내 처리됩니다.
        카드 결제의 경우 카드사 정책에 따라 반영 시점이 다를 수 있습니다.
      </p>

      <h2>6. 소비자 보호</h2>
      <p>
        전자상거래 등에서의 소비자보호에 관한 법률, 소비자분쟁해결기준에 따라
        소비자 권익을 보호합니다. 분쟁이 해결되지 않을 경우 한국소비자원
        (<a href="https://www.kca.go.kr" target="_blank" rel="noopener noreferrer">www.kca.go.kr</a>)에
        조정을 신청하실 수 있습니다.
      </p>
    </article>
  );
}
