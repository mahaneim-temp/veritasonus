/**
 * user_wallet — 1인당 잔여 시간 관리.
 *
 * 잔액 구조:
 *   free_seconds_remaining : 이번 달 무료 10분 (월 리셋, 이월X)
 *   purchased_seconds      : 충전분 (만료X)
 *   granted_seconds        : 관리자 지급 (만료X)
 *
 * 소진 순서: free → purchased → granted
 * Lazy reset: 접근 시 KST 월 기준으로 free 리셋.
 *
 * Admin(role=admin|superadmin) 과 unlimited 권한은 지갑 우회 — 무제한.
 * (unlimited 는 관리자 메뉴 접근은 없지만 사용량만 무제한인 별도 권한)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types.gen";
import { kstYyyymm } from "./quota";

type Sb = SupabaseClient<Database>;

export const FREE_MONTHLY_SECONDS = 600; // 10분

export interface Wallet {
  user_id: string;
  free_seconds_remaining: number;
  free_reset_yyyymm: string;
  purchased_seconds: number;
  granted_seconds: number;
  updated_at: string;
}

/** 지갑을 읽거나 없으면 기본값 반환 (아직 저장 안 함). */
async function readWallet(sb: Sb, userId: string): Promise<Wallet> {
  const { data } = await sb
    .from("user_wallet")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as Wallet;
  const now = kstYyyymm();
  return {
    user_id: userId,
    free_seconds_remaining: FREE_MONTHLY_SECONDS,
    free_reset_yyyymm: now,
    purchased_seconds: 0,
    granted_seconds: 0,
    updated_at: new Date().toISOString(),
  };
}

/** 월 경계 lazy reset: 현재 달과 다르면 free 리셋. */
function applyMonthReset(wallet: Wallet, now: Date = new Date()): Wallet {
  const thisMonth = kstYyyymm(now);
  if (wallet.free_reset_yyyymm === thisMonth) return wallet;
  return {
    ...wallet,
    free_seconds_remaining: FREE_MONTHLY_SECONDS,
    free_reset_yyyymm: thisMonth,
  };
}

/** 총 잔여 초 (admin 체크 없음 — 호출자가 관리). */
export function computeRemaining(wallet: Wallet): number {
  return (
    wallet.free_seconds_remaining +
    wallet.purchased_seconds +
    wallet.granted_seconds
  );
}

/**
 * 지갑 읽기 + lazy reset 적용. DB 에 변경이 있으면 upsert.
 * admin/superadmin 은 이 함수를 호출하지 말고 호출 전에 역할 체크할 것.
 */
export async function getWallet(
  sb: Sb,
  userId: string,
  now: Date = new Date(),
): Promise<Wallet> {
  const raw = await readWallet(sb, userId);
  const reset = applyMonthReset(raw, now);
  if (reset.free_reset_yyyymm !== raw.free_reset_yyyymm) {
    // 월이 바뀐 경우 upsert
    const toSave = { ...reset, updated_at: new Date().toISOString() };
    await sb.from("user_wallet").upsert(toSave, { onConflict: "user_id" });
    return toSave;
  }
  return raw;
}

/**
 * 사용 시간을 소진 우선순위 순으로 차감:
 * free → purchased → granted.
 * 반환: 차감 후 지갑.
 */
export async function deductUsage(
  sb: Sb,
  userId: string,
  deltaSeconds: number,
  now: Date = new Date(),
): Promise<Wallet> {
  if (deltaSeconds <= 0) return getWallet(sb, userId, now);
  const wallet = await getWallet(sb, userId, now);
  let rem = Math.ceil(deltaSeconds);

  let free = wallet.free_seconds_remaining;
  let purchased = wallet.purchased_seconds;
  let granted = wallet.granted_seconds;

  if (free > 0) {
    const use = Math.min(free, rem);
    free -= use;
    rem -= use;
  }
  if (rem > 0 && purchased > 0) {
    const use = Math.min(purchased, rem);
    purchased -= use;
    rem -= use;
  }
  if (rem > 0 && granted > 0) {
    const use = Math.min(granted, rem);
    granted -= use;
    rem -= use;
  }
  // rem > 0 is overage — allow (session already ran); just floor at 0
  free = Math.max(0, free);
  purchased = Math.max(0, purchased);
  granted = Math.max(0, granted);

  const updated: Wallet = {
    ...wallet,
    free_seconds_remaining: free,
    purchased_seconds: purchased,
    granted_seconds: granted,
    updated_at: new Date().toISOString(),
  };
  await sb.from("user_wallet").upsert(updated, { onConflict: "user_id" });
  return updated;
}

/**
 * 관리자 지급: granted_seconds 증가.
 * audit_log 기록은 호출자가 담당.
 */
export async function adminGrantSeconds(
  sb: Sb,
  userId: string,
  seconds: number,
  now: Date = new Date(),
): Promise<Wallet> {
  const wallet = await getWallet(sb, userId, now);
  const updated: Wallet = {
    ...wallet,
    granted_seconds: wallet.granted_seconds + seconds,
    updated_at: new Date().toISOString(),
  };
  await sb.from("user_wallet").upsert(updated, { onConflict: "user_id" });
  return updated;
}

/**
 * 충전 구매 처리:
 * 1) 이번 달 남은 무료분 → purchased 로 이관 (carry-over).
 * 2) 팩 base + bonus 추가.
 * 반환: { wallet, carriedFreeSeconds }.
 */
export async function creditPurchase(
  sb: Sb,
  userId: string,
  baseSeconds: number,
  bonusSeconds: number,
  now: Date = new Date(),
): Promise<{ wallet: Wallet; carriedFreeSeconds: number }> {
  const wallet = await getWallet(sb, userId, now);
  const carry = wallet.free_seconds_remaining;
  const updated: Wallet = {
    ...wallet,
    free_seconds_remaining: 0,
    purchased_seconds:
      wallet.purchased_seconds + carry + baseSeconds + bonusSeconds,
    updated_at: new Date().toISOString(),
  };
  await sb.from("user_wallet").upsert(updated, { onConflict: "user_id" });
  return { wallet: updated, carriedFreeSeconds: carry };
}

/**
 * 역할 기반 유효 잔여 초. admin/superadmin/unlimited → null(무제한).
 * 회원이 아직 지갑이 없으면 기본 free 600s 적용.
 */
export async function getEffectiveRemaining(
  sb: Sb,
  userId: string,
  role: string | null | undefined,
  now: Date = new Date(),
): Promise<number | null> {
  if (role === "admin" || role === "superadmin" || role === "unlimited") {
    return null; // unlimited
  }
  const wallet = await getWallet(sb, userId, now);
  return computeRemaining(wallet);
}
