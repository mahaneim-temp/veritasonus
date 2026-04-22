/**
 * POST /api/billing/checkout
 *
 * Stripe Checkout Session 을 생성하고 url을 반환.
 * 회원만 호출 가능. 게스트는 먼저 회원가입 유도.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { stripe, priceIdFor } from "@/lib/billing/stripe";
import { logger } from "@/lib/utils/logger";
import type { CheckoutResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  plan: z.enum(["pro_monthly", "pro_yearly"]),
  return_url: z.string().url().optional(),
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

  const ct = req.headers.get("content-type") ?? "";
  let body: unknown = {};
  if (ct.includes("application/json")) {
    body = await req.json().catch(() => ({}));
  } else if (ct.includes("application/x-www-form-urlencoded")) {
    const f = await req.formData();
    body = {
      plan: f.get("plan"),
      return_url: f.get("return_url"),
    };
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation", message: "plan 필요" } },
      { status: 422 },
    );
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const successUrl = `${base}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = parsed.data.return_url ?? `${base}/pricing?canceled=1`;

  try {
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceIdFor(parsed.data.plan), quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: user.email ?? undefined,
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        plan: parsed.data.plan,
      },
      allow_promotion_codes: true,
    });
    if (!session.url) throw new Error("no checkout url");

    // form post에서 호출되었을 가능성 → 303 redirect로 응답 (브라우저 호환)
    if (ct.includes("application/x-www-form-urlencoded")) {
      return NextResponse.redirect(session.url, { status: 303 });
    }
    const payload: CheckoutResponse = { checkout_url: session.url };
    return NextResponse.json(payload);
  } catch (e) {
    logger.error("checkout_create_failed", { e: String(e) });
    return NextResponse.json(
      { error: { code: "internal", message: "결제 페이지 생성 실패" } },
      { status: 500 },
    );
  }
}
