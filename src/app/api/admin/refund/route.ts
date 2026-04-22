/**
 * POST /api/admin/refund — 관리자가 특정 Stripe charge/payment_intent 를 환불.
 *
 * body:
 *   { stripe_id: string, reason?: string, amount_krw?: number }
 *     stripe_id: charge (ch_xxx) 또는 payment_intent (pi_xxx).
 *     amount_krw: 부분 환불 (없으면 전액 환불).
 *
 * 수퍼관리자(superadmin) 만 실행 가능. 환불 성공·실패 모두 audit_log 에 기록.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/billing/stripe";
import { supabaseServer } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  stripe_id: z.string().min(3).max(100),
  reason: z.string().max(500).optional(),
  amount_krw: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthenticated", message: "로그인 필요" } },
      { status: 401 },
    );
  }
  const { data: prof } = await sb
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();
  // 환불은 특히 민감 — superadmin 만.
  if (!prof || prof.role !== "superadmin") {
    return NextResponse.json(
      { error: { code: "forbidden", message: "수퍼관리자 전용" } },
      { status: 403 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation", message: "검증 실패" } },
      { status: 422 },
    );
  }

  const { stripe_id, reason, amount_krw } = parsed.data;

  try {
    const refundArgs: Record<string, unknown> = { reason: "requested_by_customer" };
    if (stripe_id.startsWith("pi_")) refundArgs.payment_intent = stripe_id;
    else refundArgs.charge = stripe_id;
    if (amount_krw) refundArgs.amount = amount_krw;
    const refund = await stripe().refunds.create(refundArgs);

    await audit({
      actorId: user.id,
      action: "refund",
      targetType: "billing_event",
      targetId: stripe_id,
      payload: {
        refund_id: refund.id,
        amount_krw: refund.amount,
        reason: reason ?? null,
        status: refund.status,
      },
    });

    return NextResponse.json({
      ok: true,
      refund_id: refund.id,
      amount_krw: refund.amount,
      status: refund.status,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("admin_refund_failed", { stripe_id, err: msg });
    await audit({
      actorId: user.id,
      action: "refund",
      targetType: "billing_event",
      targetId: stripe_id,
      payload: { ok: false, error: msg.slice(0, 500), reason: reason ?? null },
    });
    return NextResponse.json(
      { error: { code: "stripe_error", message: msg } },
      { status: 500 },
    );
  }
}
