/**
 * F-1 사용량 누적 (gateway 측).
 *
 * 세션 종료 시 경과 초를 usage_monthly 에 upsert.
 * 대응 웹앱 측 로직: src/lib/billing/quota.ts
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./db-types.js";

export function kstYyyymm(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

/**
 * 회원 세션의 초 수를 이번 달(KST) 누적에 더한다. 게스트 세션은 skip.
 *
 * 멱등성: 같은 세션 ID 로 두 번 호출되지 않도록 호출자가 책임진다
 * (control.end 분기 1회, ws.close 분기 1회 — 둘 중 하나만 실행되게 flag 사용).
 */
export async function addSessionUsage(
  sb: SupabaseClient<Database>,
  ownerType: "member" | "guest",
  ownerId: string,
  seconds: number,
  now: Date = new Date(),
): Promise<void> {
  if (ownerType !== "member") return;
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const yyyymm = kstYyyymm(now);
  const { data: existing } = await sb
    .from("usage_monthly")
    .select("seconds_used")
    .eq("user_id", ownerId)
    .eq("yyyymm", yyyymm)
    .maybeSingle();
  const next = Number(existing?.seconds_used ?? 0) + Math.floor(seconds);
  await sb.from("usage_monthly").upsert(
    {
      user_id: ownerId,
      yyyymm,
      seconds_used: next,
    },
    { onConflict: "user_id,yyyymm" },
  );
}
