/**
 * 게스트 트라이얼 — 서버 사이드 관리.
 * Redis(Upstash)를 "진실의 원천"으로 사용한다.
 *
 * key:  trial:{guest_id}  (TTL = trial_seconds)
 * val:  remaining_seconds (int 문자열)
 *
 * Redis가 실패하면 guest_sessions.expires_at 을 fallback.
 */

import { Redis } from "@upstash/redis";
import { logger } from "@/lib/utils/logger";

let _redis: Redis | null = null;
function redis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    logger.warn("upstash_not_configured — trial fallback to DB only");
    return null;
  }
  _redis = new Redis({ url, token });
  return _redis;
}

export const DEFAULT_TRIAL_SECONDS =
  Number(process.env.GUEST_TRIAL_SECONDS ?? 600) || 600;

/** 홈페이지 1분 맛보기 체험 */
export const TASTE_TRIAL_SECONDS =
  Number(process.env.TASTE_TRIAL_SECONDS ?? 60) || 60;

export const WARN_SECONDS =
  Number(process.env.GUEST_TRIAL_WARN_SECONDS ?? 120) || 120;

export async function initTrial(
  guestId: string,
  seconds: number = DEFAULT_TRIAL_SECONDS,
): Promise<void> {
  const r = redis();
  if (!r) return;
  await r.set(`trial:${guestId}`, seconds, { ex: seconds + 60 });
}

export async function decrementTrial(
  guestId: string,
  deltaS: number,
): Promise<number> {
  const r = redis();
  if (!r) return Number.POSITIVE_INFINITY; // fallback: 제한 없음 (개발 편의)
  // DECRBY 후 TTL 유지
  const remaining = (await r.decrby(`trial:${guestId}`, deltaS)) as number;
  if (remaining <= 0) {
    // expire 즉시
    await r.del(`trial:${guestId}`);
    return 0;
  }
  return remaining;
}

export async function getRemaining(guestId: string): Promise<number | null> {
  const r = redis();
  if (!r) return null;
  const v = await r.get<number>(`trial:${guestId}`);
  if (v == null) return 0;
  return v;
}

export async function purgeTrial(guestId: string): Promise<void> {
  const r = redis();
  if (!r) return;
  await r.del(`trial:${guestId}`);
}
