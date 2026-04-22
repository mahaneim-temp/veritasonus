/**
 * RTT 워치독 — 30초 이상 median RTT > 600ms 지속 시 네트워크 저하 경고.
 *
 * SSOT §14: RTT 임계 (양호/보통/경고).
 * KICKOFF §4-D: "RTT 중앙값 > 600ms 이 30초 이상 지속되면 UI 에 네트워크 품질 저하 배너".
 *
 * 순수 함수. 호출자는 sample(now, rttMs) 로 새 샘플을 넣고 반환되는 상태를 UI 에 반영.
 */

export const DEFAULT_THRESHOLD_MS = 600;
export const DEFAULT_SUSTAINED_MS = 30_000;
/** 오래된 샘플은 잘라내는 윈도우. 30초 sustained 를 판별하려면 적어도 그만큼 유지. */
export const DEFAULT_WINDOW_MS = 60_000;

export interface RttSample {
  atMs: number;
  rttMs: number;
}

export interface RttWatchdogState {
  samples: RttSample[];
  /** median > threshold 이 된 시점 (유지 시작). 없으면 null. */
  badSinceMs: number | null;
}

export interface RttWatchdogConfig {
  thresholdMs: number;
  sustainedMs: number;
  windowMs: number;
}

export const DEFAULT_CONFIG: RttWatchdogConfig = {
  thresholdMs: DEFAULT_THRESHOLD_MS,
  sustainedMs: DEFAULT_SUSTAINED_MS,
  windowMs: DEFAULT_WINDOW_MS,
};

export const INITIAL_WATCHDOG: RttWatchdogState = {
  samples: [],
  badSinceMs: null,
};

export type WatchdogLevel = "ok" | "degraded";

export interface SampleResult {
  next: RttWatchdogState;
  level: WatchdogLevel;
  medianMs: number | null;
}

/** 새 RTT 샘플을 기록하고 현재 경고 레벨을 계산한다. */
export function sample(
  prev: RttWatchdogState,
  nowMs: number,
  rttMs: number,
  cfg: RttWatchdogConfig = DEFAULT_CONFIG,
): SampleResult {
  // 1. 윈도우 밖 샘플 제거.
  const cutoff = nowMs - cfg.windowMs;
  const kept = prev.samples.filter((s) => s.atMs >= cutoff);
  kept.push({ atMs: nowMs, rttMs });

  // 2. 현재 윈도우의 중앙값.
  const median = medianOf(kept.map((s) => s.rttMs));

  // 3. 현재 샘플이 임계 초과면 badSince 유지/시작, 아니면 리셋.
  let badSinceMs: number | null;
  if (median !== null && median > cfg.thresholdMs) {
    badSinceMs = prev.badSinceMs ?? nowMs;
  } else {
    badSinceMs = null;
  }

  // 4. sustained 만큼 버텼는지.
  const level: WatchdogLevel =
    badSinceMs !== null && nowMs - badSinceMs >= cfg.sustainedMs
      ? "degraded"
      : "ok";

  return {
    next: { samples: kept, badSinceMs },
    level,
    medianMs: median,
  };
}

function medianOf(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}
