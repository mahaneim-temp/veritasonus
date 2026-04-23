/**
 * /legal/business — 사업자 정보 공시 (통신판매업 표시 의무).
 * ⚠️  아래 BUSINESS_INFO 의 각 필드를 실제 티엘테크 정보로 교체 후 배포.
 */

const BUSINESS_INFO = {
  company: "티엘테크",               // TODO: 정확한 상호
  representative: "PLACEHOLDER",     // TODO: 대표자 이름
  businessNumber: "000-00-00000",    // TODO: 사업자등록번호
  mailOrderNumber: "제0000-서울00-0000호", // TODO: 통신판매업 신고번호
  address: "서울특별시 00구 00로 00",  // TODO: 사업장 주소
  email: "support@lucid-interpret.app",
  hosting: "Vercel, Inc. / Supabase, Inc.",
};

export const metadata = { title: "사업자 정보" };

export default function BusinessInfoPage() {
  return (
    <article className="container max-w-2xl py-12 prose prose-sm">
      <h1>사업자 정보</h1>
      <p className="text-xs text-warning bg-warning/10 rounded px-3 py-2 not-prose">
        ⚠️ 이 페이지의 일부 정보는 아직 확정되지 않은 플레이스홀더입니다. 배포 전 실제 정보로 교체하세요.
      </p>

      <table className="w-full text-sm not-prose mt-6 border-collapse">
        <tbody>
          {[
            ["상호", BUSINESS_INFO.company],
            ["대표자", BUSINESS_INFO.representative],
            ["사업자등록번호", BUSINESS_INFO.businessNumber],
            ["통신판매업 신고번호", BUSINESS_INFO.mailOrderNumber],
            ["사업장 주소", BUSINESS_INFO.address],
            ["고객센터", BUSINESS_INFO.email],
            ["호스팅 서비스 제공자", BUSINESS_INFO.hosting],
          ].map(([label, value]) => (
            <tr key={label} className="border-b border-border-subtle">
              <td className="py-2.5 pr-6 font-medium text-ink-secondary whitespace-nowrap w-48">{label}</td>
              <td className="py-2.5 text-ink-primary">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-8 text-xs text-ink-muted">
        문의사항은{" "}
        <a href={`mailto:${BUSINESS_INFO.email}`} className="underline">
          {BUSINESS_INFO.email}
        </a>
        로 연락 주시기 바랍니다.
      </p>
    </article>
  );
}
