import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

let _client: Redis | null = null;

function client(): Redis | null {
  if (_client) return _client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _client = new Redis({ url, token });
  return _client;
}

export function getLimiter(
  name: string,
  tokens: number,
  windowSec: number,
): Ratelimit | null {
  const c = client();
  if (!c) return null;
  return new Ratelimit({
    redis: c,
    limiter: Ratelimit.slidingWindow(tokens, `${windowSec} s`),
    prefix: `rl:${name}`,
    analytics: false,
  });
}

/** 미구성 시 pass-through. 운영에선 반드시 구성 필요. */
export async function rateLimit(
  limiter: Ratelimit | null,
  key: string,
): Promise<{ success: boolean; remaining: number }> {
  if (!limiter) return { success: true, remaining: Number.POSITIVE_INFINITY };
  const { success, remaining } = await limiter.limit(key);
  return { success, remaining };
}
