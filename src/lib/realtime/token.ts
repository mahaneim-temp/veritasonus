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
  /** 회원의 유효 잔여 초 (free+purchased+granted). admin 은 24*3600 으로 클램프. */
  effective_remaining_s: number;
  /** true 이면 utterance DB 저장 skip (맛보기 trial). */
  skip_persist?: boolean;
  /** STT 입력 언어 (ISO/BCP-47: "en", "ko" 등). gateway Provider 가 STT 구성에 사용. */
  source_lang: string;
  /** 번역 출력 언어. */
  target_lang: string;
  /**
   * 세션 모드. gateway 의 병합/세그먼트 창 크기 결정에 사용.
   *   - interactive_interpretation: 짧게 끊어 빠르게 (대화형)
   *   - listener_live / listener_live_recorded: 연설 톤, 창 크게
   *   - assist_interpretation / conversation_learning: 중간
   * 누락 시 gateway 가 'interactive_interpretation' 기본값으로 처리.
   */
  mode?: string;
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
