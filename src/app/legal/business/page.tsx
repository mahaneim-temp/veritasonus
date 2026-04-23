/**
 * /legal/business — 사업자 정보 공시 (전자상거래법 통신판매업 표시 의무).
 *
 * 실제 값 수정: src/lib/business.ts 의 BUSINESS 객체만 편집하면 된다.
 * null 항목 = 아직 미확정, "확인 후 기재" 로 표시됨.
 */

import { BUSINESS, biz } from "@/lib/business";

export const metadata = { title: "사업자 정보" };

const ROWS: [string, string][] = [
  // 법적 식별 정보
  ["상호",                BUSINESS.companyFull],
  ["대표자",              BUSINESS.representative],
  ["사업자등록번호",       BUSINESS.businessNumber],
  ["법인등록번호",         BUSINESS.corporateNumber],
  ["통신판매업 신고번호",  BUSINESS.mailOrderNumber],
  // 소재지 / 업종
  ["사업장 소재지",        BUSINESS.address],
  ["업태",                BUSINESS.businessType],
  ["종목",                BUSINESS.businessCategory],
  // 연락처
  ["전화번호",            BUSINESS.phone],
  ["고객센터 이메일",      BUSINESS.supportEmail],
  // 인프라 / 책임자 (미확정)
  ["호스팅 서비스 제공자", biz(BUSINESS.hosting)],
  ["개인정보 보호책임자",  biz(BUSINESS.privacyOfficer)],
];

/** null 항목이 하나라도 있으면 배너를 표시한다. */
const HAS_PENDING =
  BUSINESS.hosting === null || BUSINESS.privacyOfficer === null;

export default function BusinessInfoPage() {
  return (
    <article className="container max-w-2xl py-12 prose prose-sm">
      <h1>사업자 정보</h1>

      {HAS_PENDING && (
        <p className="text-xs bg-warning/10 text-warning rounded px-3 py-2 not-prose">
          ⚠️ 일부 항목은 아직 확정되지 않아 &ldquo;확인 후 기재&rdquo; 로 표시됩니다.
          확정 즉시 <code>src/lib/business.ts</code> 에 값을 입력하면 자동 반영됩니다.
        </p>
      )}

      <table className="w-full text-sm not-prose mt-6 border-collapse">
        <tbody>
          {ROWS.map(([label, value]) => (
            <tr key={label} className="border-b border-border-subtle">
              <td className="py-2.5 pr-6 font-medium text-ink-secondary whitespace-nowrap w-48">
                {label}
              </td>
              <td
                className={`py-2.5 ${
                  value === "확인 후 기재"
                    ? "text-ink-muted italic"
                    : "text-ink-primary"
                }`}
              >
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-8 text-xs text-ink-muted">
        문의:{" "}
        <a href={`mailto:${BUSINESS.supportEmail}`} className="underline">
          {BUSINESS.supportEmail}
        </a>
        {" "}·{" "}
        <a href={`tel:${BUSINESS.phone.replace(/-/g, "")}`} className="underline">
          {BUSINESS.phone}
        </a>
      </p>
    </article>
  );
}
