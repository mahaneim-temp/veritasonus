/**
 * 게이트웨이 토큰 수명 관리 (A-4).
 * 만료 5분 전에 재발급을 예약한다. 순수 함수.
 *
 * /api/realtime/token 이 반환하는 expires_at (ISO string) 을 기준으로
 * "지금부터 몇 ms 후에 재발급해야 하는지" 를 계산.
 */

export const REFRESH_LEAD_MS = 5 * 60 * 1000;

/** 토큰을 즉시 재발급해야 하는지 (이미 만료됐거나 리드타임 지남). */
export function needsImmediateRefresh(
  expiresAt: Date,
  now: Date,
  leadMs = REFRESH_LEAD_MS,
): boolean {
  return expiresAt.getTime() - now.getTime() <= leadMs;
}

/**
 * 다음 재발급까지의 대기 시간(ms). 이미 리드타임 지났으면 0.
 * null 이면 토큰이 너무 짧아 재발급이 의미 없음(이미 만료).
 */
export function scheduleRefreshDelayMs(
  expiresAt: Date,
  now: Date,
  leadMs = REFRESH_LEAD_MS,
): number {
  const remaining = expiresAt.getTime() - now.getTime();
  if (remaining <= 0) return 0;
  const delay = remaining - leadMs;
  return delay <= 0 ? 0 : delay;
}

/** ISO 문자열 파싱 헬퍼. 잘못된 입력은 null. */
export function parseExpiresAt(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
