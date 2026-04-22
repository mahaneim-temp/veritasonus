export interface Plan {
  id: "free" | "pro_monthly" | "pro_yearly";
  name: string;
  priceKrw: number;
  interval: "monthly" | "yearly" | null;
  features: string[];
  cta: string;
}

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
      "무제한 세션",
      "고품질 모드",
      "사후 복원 무제한",
      "내보내기 (PDF/이메일)",
      "자료 업로드 50MB/세션",
    ],
    cta: "월간 시작",
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
  },
];

export function planById(id: Plan["id"]): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}
