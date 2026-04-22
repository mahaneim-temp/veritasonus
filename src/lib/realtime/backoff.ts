/**
 * 지수 백오프 재연결 스케줄 (A-4).
 * 순수 함수. Timer 는 호출자(훅)가 setTimeout 로 돌린다.
 *
 * 정책 (SSOT §14 · KICKOFF §4-D):
 *   - 최대 3회 재연결 시도
 *   - 대기: 1s → 2s → 4s (지수 + 가벼운 지터 허용)
 *   - 3회 모두 실패 시 "재연결 포기" 신호
 */

/** 시도 차수(1-indexed). 1, 2, 3 에 대해 ms 반환. 범위 밖은 null. */
export function backoffDelayMs(attempt: number, jitterRatio = 0): number | null {
  if (!Number.isFinite(attempt) || attempt < 1 || attempt > 3) return null;
  const base = Math.pow(2, attempt - 1) * 1000; // 1000, 2000, 4000
  if (jitterRatio <= 0) return base;
  // 대칭 지터: base * (1 ± jitterRatio). Math.random() 은 호출자가 주입 가능.
  // 이 헬퍼는 결정적 값만 반환; 지터는 상위 래퍼에서 적용.
  return base;
}

/** 시도 차수가 정책 범위 내(1~3) 인지. */
export function shouldRetry(attempt: number): boolean {
  return backoffDelayMs(attempt) !== null;
}

/** Timer 없이 동기적으로 다음 시도 번호를 계산. 시작은 1. */
export function nextAttempt(current: number): number {
  return current + 1;
}

/** 백오프 상태(호출자가 보관). */
export interface BackoffState {
  attempt: number; // 현재까지 시도한 횟수. 0 = 아직 시도 없음.
  gaveUp: boolean;
}

export const INITIAL_BACKOFF: BackoffState = { attempt: 0, gaveUp: false };

/** 한 번의 시도 후 상태 전이. 지연값과 다음 상태를 반환. */
export function planNextAttempt(
  prev: BackoffState,
): { delayMs: number; next: BackoffState } | { delayMs: null; next: BackoffState } {
  const attempt = prev.attempt + 1;
  const delay = backoffDelayMs(attempt);
  if (delay === null) {
    return { delayMs: null, next: { attempt, gaveUp: true } };
  }
  return { delayMs: delay, next: { attempt, gaveUp: false } };
}

/** 성공 시 상태 리셋. */
export function resetBackoff(): BackoffState {
  return INITIAL_BACKOFF;
}
