/**
 * Ephemeral JWT 검증 (브라우저 → gateway).
 * Next.js 의 src/lib/realtime/token.ts 와 같은 시크릿/포맷을 공유한다.
 */

import { jwtVerify } from "jose";
import { ENV } from "./env.js";

export interface RealtimeClaims {
  sub: string;
  owner_type: "guest" | "member";
  session_id: string;
  trial_remaining_s: number;
  iat: number;
  exp: number;
}

let _secret: Uint8Array | null = null;
function secret(): Uint8Array {
  if (_secret) return _secret;
  if (!ENV.REALTIME_GATEWAY_SECRET || ENV.REALTIME_GATEWAY_SECRET.length < 16) {
    throw new Error("REALTIME_GATEWAY_SECRET not configured");
  }
  _secret = new TextEncoder().encode(ENV.REALTIME_GATEWAY_SECRET);
  return _secret;
}

export async function verifyToken(token: string): Promise<RealtimeClaims> {
  const { payload } = await jwtVerify(token, secret());
  return payload as unknown as RealtimeClaims;
}
