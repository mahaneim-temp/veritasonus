/**
 * 티엘테크 주식회사 — 사업자 정보 단일 출처(SSOT).
 *
 * Footer와 /legal/business 두 곳이 이 파일을 공유한다.
 * 값을 바꿀 때 이 파일 한 곳만 수정하면 양쪽에 자동 반영된다.
 *
 * 확정된 항목: 실제 값 기입 완료.
 * 미확정 항목: null → UI 에서 "확인 후 기재" 로 표시.
 */

export const BUSINESS = {
  // ── 확정 (사업자등록증 + 통신판매업 신고 + 대표 연락처) ────
  /** 법적 상호 (전체) */
  companyFull: "티엘테크 주식회사",
  /** 약식 상호 (footer 등 짧은 표기) */
  companyShort: "티엘테크",
  /** 대표자 */
  representative: "유영수",
  /** 사업자등록번호 */
  businessNumber: "867-86-01347",
  /** 법인등록번호 */
  corporateNumber: "131111-0541796",
  /** 통신판매업 신고번호 */
  mailOrderNumber: "2020-성남중원-1124",
  /** 사업장 소재지 (본점 동일) */
  address: "경기도 성남시 중원구 둔촌대로101번길 27, 엠타워 865호 (성남동)",
  /** 대표 전화번호 (고객센터) */
  phone: "010-6399-1913",
  /** 고객센터 이메일 */
  supportEmail: "mahaneim@naver.com",
  /** 업태 */
  businessType: "제조업, 도매 및 소매업",
  /** 종목 */
  businessCategory: "농기계, 일반기계, 전자상거래업",

  // ── 미확정 — null 이면 UI 에서 "확인 후 기재" 표시 ─────────
  /** 호스팅 서비스 제공자 — 확정 후 기재 */
  hosting: null as string | null,
  /** 개인정보 보호책임자 성명 — 지정 후 기재 */
  privacyOfficer: null as string | null,
} as const;

/** null 값을 footer/표 에서 표시할 대체 문자열로 변환 */
export function biz(value: string | null, fallback = "확인 후 기재"): string {
  return value ?? fallback;
}
