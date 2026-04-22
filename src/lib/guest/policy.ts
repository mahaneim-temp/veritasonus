/**
 * 게스트 체험 진입 정책.
 *
 * 테스트 단계에서는 비회원 체험을 허용하지만, 공개 베타·상용 전환 시에는
 * "회원가입 → 10분 체험" 으로 전환 가능해야 한다. 환경변수 하나로 토글.
 *
 * 켜는 법:
 *   .env.local 에 REQUIRE_SIGNUP_FOR_TRIAL=true
 *   (미들웨어·API 양쪽에서 참조 — 서버 side env 라 번들에 노출되지 않음.)
 */

export function isSignupRequiredForTrial(): boolean {
  const raw = (process.env.REQUIRE_SIGNUP_FOR_TRIAL ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}
