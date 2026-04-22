/**
 * 게스트 트라이얼 카운터 (Redis).
 *
 * gateway 는 음원 스트림이 흐르는 동안 5초 간격으로 5초씩 차감한다.
 * 0초가 되면 ws.close(4001, "trial_expired").
 *
 * Redis가 미구성된 환경(local dev)에서는 무한대로 취급.
 */

import { Redis } from "@upstash/redis";
import { ENV } from "./env.js";

let _r: Redis | null = null;
function redis(): Redis | null {
  if (_r) return _r;
  if (!ENV.UPSTASH_REDIS_REST_URL || !ENV.UPSTASH_REDIS_REST_TOKEN) return null;
  _r = new Redis({
    url: ENV.UPSTASH_REDIS_REST_URL,
    token: ENV.UPSTASH_REDIS_REST_TOKEN,
  });
  return _r;
}

export async function decrement(
  guestId: string,
  delta: number,
): Promise<number> {
  const r = redis();
  if (!r) return Number.POSITIVE_INFINITY;
  const remaining = (await r.decrby(`trial:${guestId}`, delta)) as number;
  if (remaining <= 0) {
    await r.del(`trial:${guestId}`);
    return 0;
  }
  return remaining;
}

export async function peek(guestId: string): Promise<number> {
  const r = redis();
  if (!r) return Number.POSITIVE_INFINITY;
  const v = (await r.get<number>(`trial:${guestId}`)) ?? 0;
  return v;
}
