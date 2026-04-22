/**
 * Ephemeral JWT 발급/검증 (HS256).
 * Next.js 서버 → 발급.
 * realtime-gateway → 검증.
 */

import { SignJWT, jwtVerify } from "jose";

export interface RealtimeClaims {
  sub: string; // owner_id
  owner_type: "guest" | "member";
  session_id: string;
  trial_remaining_s: number;
  iat: number;
  exp: number;
}

function secret(): Uint8Array {
  const s = process.env.REALTIME_GATEWAY_SECRET;
  if (!s || s.length < 16)
    throw new Error("REALTIME_GATEWAY_SECRET not configured");
  return new TextEncoder().encode(s);
}

export async function signRealtimeToken(
  claims: Omit<RealtimeClaims, "iat" | "exp">,
  ttlSeconds = 900,
): Promise<{ token: string; expires_at: string }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;
  const token = await new SignJWT({ ...claims } as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secret());
  return { token, expires_at: new Date(exp * 1000).toISOString() };
}

export async function verifyRealtimeToken(
  token: string,
): Promise<RealtimeClaims> {
  const { payload } = await jwtVerify(token, secret());
  return payload as unknown as RealtimeClaims;
}
