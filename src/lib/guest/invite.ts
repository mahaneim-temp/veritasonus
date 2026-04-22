/**
 * Invite code 검증 — 테스트 단계만 사용.
 * 베타 이후 INVITE_CODES env 를 비우면 자동 비활성.
 */

export function isInviteRequired(): boolean {
  const raw = process.env.INVITE_CODES ?? "";
  return raw.trim().length > 0;
}

export function isInviteValid(code: string | undefined): boolean {
  if (!isInviteRequired()) return true;
  if (!code) return false;
  const whitelist = (process.env.INVITE_CODES ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return whitelist.includes(code);
}
