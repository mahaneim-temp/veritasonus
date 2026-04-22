export interface Plan {
  id: "free" | "pro_monthly" | "pro_yearly";
  name: string;
  priceKrw: number;
  interval: "monthly" | "yearly" | null;
  features: string[];
  cta: string;
  /** 현재 가격·한도가 Google Cloud 실측 전 가정값인지 여부. UI 가 고지 배너에 사용. */
  assumed?: boolean;
}

/**
 * ⚠ 현재 priceKrw · features 의 숫자 값은 모두 **가정값**이다.
 * Google Cloud STT ($0.024/분) + Translation ($20/1M char) + Gemini 호출 원가를
 * 실측한 뒤 최종 확정해야 한다. F-1 usage_monthly 누적 데이터로 실측 가능.
 * 확정 시 본 파일과 /pricing 페이지 배너를 같은 커밋에서 갱신.
 */
export const PRICING_IS_ASSUMED = true;

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free 체험",
    priceKrw: 0,
    interval: null,
    features: [
      "10분 무료 체험",
      "대화록 7일 보관",
      "저장/내보내기 제한",
      "사후 복원 1회 미리보기",
    ],
    cta: "무료로 시작",
  },
  {
    id: "pro_monthly",
    name: "Pro · 월간",
    priceKrw: 29000,
    interval: "monthly",
    features: [
      "월 20시간(가정) 사용 가능",
      "고품질 모드",
      "사후 복원 무제한",
      "내보내기 (PDF/이메일)",
      "자료 업로드 50MB/세션",
    ],
    cta: "월간 시작",
    assumed: true,
  },
  {
    id: "pro_yearly",
    name: "Pro · 연간",
    priceKrw: 290000,
    interval: "yearly",
    features: [
      "월간 전체 + 2개월 무료",
      "우선 지원",
      "팀 공유(베타)",
    ],
    cta: "연간 시작",
    assumed: true,
  },
];

export function planById(id: Plan["id"]): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

// ── F-1 사용량 쿼터 ──────────────────────────────────────────
// 월별 한도(초). 원가(OpenAI Realtime 단가 × 실측) 기반으로 추후 형님이 최종 확정.
// 현 값은 "Pro = 20시간/월, Team = 100시간/월" 가이드라인 (KICKOFF §5-B 기본값).
// Free 는 월 한도 없음 — 게스트 10분 + 회원 제한은 별도 정책.
export const PLAN_QUOTA_SECONDS: Record<string, number | null> = {
  free: null, // free 회원은 사용량 쿼터가 아니라 게스트 10분 정책 및 기능 제한.
  pro_monthly: 20 * 3600,
  pro_yearly: 20 * 3600,
  team: 100 * 3600, // 아직 enum 에 없으나 F-1 이후 확장.
};

export const QUOTA_WARN_RATIO = 0.8; // 80% 도달 시 이메일 1회 경고.
export const QUOTA_LIMIT_RATIO = 1.0; // 100% 도달 시 세션 강제 종료.

/** role / plan 에서 쿼터(초)를 얻는다. null = 쿼터 미적용(무제한 또는 Free 정책). */
export function quotaSecondsForRole(role: string | null | undefined): number | null {
  // role 은 users.role enum: guest | member | paid | admin | superadmin.
  // v1 은 단순 매핑: paid → pro_monthly 쿼터, 외 → null.
  if (role === "paid") return PLAN_QUOTA_SECONDS["pro_monthly"] ?? null;
  if (role === "admin" || role === "superadmin") return null;
  return null;
}
