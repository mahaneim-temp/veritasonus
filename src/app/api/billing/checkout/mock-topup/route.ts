/**
 * POST /api/billing/checkout/mock-topup
 *
 * 개발/테스트용 Mock 충전 엔드포인트.
 * PG 연결 없이 즉시 지갑에 충전 반영.
 *
 * MOCK_PAYMENT_ENABLED=true 환경에서만 동작 (프로덕션 안전장치).
 * body (form): pack_id
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { creditPurchase } from "@/lib/billing/wallet";
import { packById } from "@/lib/billing/plans";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const isMockEnabled =
    (process.env.MOCK_PAYMENT_ENABLED ?? "").toLowerCase() === "true";
  if (!isMockEnabled) {
    return NextResponse.redirect(new URL("/pricing?error=payment_not_configured", req.url));
  }

  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/pricing", req.url));
  }

  let packId: string | null = null;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    packId = fd.get("pack_id") as string | null;
  } else {
    const json = await req.json().catch(() => ({}));
    packId = (json as any).pack_id ?? null;
  }

  const pack = packId ? packById(packId) : undefined;
  if (!pack) {
    return NextResponse.redirect(new URL("/pricing?error=invalid_pack", req.url));
  }

  const svc = supabaseService();
  const { wallet, carriedFreeSeconds } = await creditPurchase(
    svc,
    user.id,
    pack.seconds,
    pack.bonusSeconds,
  );

  // Ledger 기록
  await svc.from("credit_packs_ledger").insert({
    user_id: user.id,
    pack_id: pack.id,
    base_seconds: pack.seconds,
    bonus_seconds: pack.bonusSeconds,
    carried_free_seconds: carriedFreeSeconds,
    price_krw: pack.priceKrw,
    payment_provider: "mock",
    provider_event_id: `mock_${Date.now()}_${user.id.slice(0, 8)}`,
  });

  await audit({
    actorId: user.id,
    action: "mock_topup",
    targetType: "user",
    targetId: user.id,
    payload: {
      pack_id: pack.id,
      base_seconds: pack.seconds,
      bonus_seconds: pack.bonusSeconds,
      carried_free_seconds: carriedFreeSeconds,
      price_krw: pack.priceKrw,
      wallet_after: {
        free_seconds_remaining: wallet.free_seconds_remaining,
        purchased_seconds: wallet.purchased_seconds,
        granted_seconds: wallet.granted_seconds,
      },
    },
  });

  return NextResponse.redirect(
    new URL(
      `/pricing?success=topup&pack=${pack.id}&minutes=${Math.round(pack.totalSeconds / 60)}`,
      req.url,
    ),
  );
}
