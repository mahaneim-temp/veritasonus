/**
 * POST /api/billing/webhook   (Stripe)
 *
 * Stripe 의 다음 이벤트를 처리:
 *   - checkout.session.completed       → users.role = 'paid', billing_events insert
 *   - customer.subscription.updated     → status sync
 *   - customer.subscription.deleted     → users.role = 'member' 로 강등
 *   - invoice.paid / invoice.payment_failed → 결제 이력
 *
 * Vercel raw body 처리:
 *   - Next.js App Router 의 Route Handler는 기본적으로 Web Request를 사용,
 *     `req.text()`로 raw body 를 안전하게 읽을 수 있다.
 *   - stripe.webhooks.constructEvent 가 서명 검증.
 */

import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/billing/stripe";
import { supabaseService } from "@/lib/supabase/service";
import { logger } from "@/lib/utils/logger";
import type { Json } from "@/lib/supabase/types.gen";
import type Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "signature 없음" } },
      { status: 400 },
    );
  }
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    logger.warn("stripe_signature_invalid", { e: String(e) });
    return NextResponse.json(
      { error: { code: "bad_signature", message: "서명 검증 실패" } },
      { status: 400 },
    );
  }

  const svc = supabaseService();

  // 멱등성 보장: billing_events.provider_event_id unique.
  // Postgres unique violation = SQLSTATE 23505. 드라이버 바뀌어도 안전하게 코드로 비교.
  try {
    const { error: insertErr } = await svc.from("billing_events").insert({
      provider_event_id: event.id,
      event_type: event.type,
      payload: event as unknown as Json,
    });
    if (insertErr && insertErr.code !== "23505") {
      throw insertErr;
    }
    if (insertErr) {
      logger.info("stripe_webhook_dup", { id: event.id });
      return NextResponse.json({ received: true, dup: true });
    }
  } catch (e) {
    logger.error("billing_events_insert_failed", { e: String(e) });
    // 멱등 저장이 실패해도 처리는 시도. 모니터링 강화 필요.
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const userId =
          (s.metadata?.user_id as string | undefined) ??
          (s.client_reference_id ?? undefined);
        if (userId) {
          await svc
            .from("users")
            .update({
              role: "paid",
              stripe_customer_id: (s.customer as string) ?? null,
              billing_status: "active",
            })
            .eq("id", userId);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const status = sub.status; // active/past_due/canceled/...
        const patch: {
          billing_status: string;
          role?: "paid";
        } = { billing_status: status };
        if (status === "active") patch.role = "paid";
        await svc
          .from("users")
          .update(patch)
          .eq("stripe_customer_id", customerId);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        await svc
          .from("users")
          .update({ billing_status: "canceled", role: "member" })
          .eq("stripe_customer_id", customerId);
        break;
      }
      default:
        // 기록만 남김 (billing_events insert 로 이미 저장됨)
        break;
    }
  } catch (e) {
    logger.error("stripe_event_handler_failed", { type: event.type, e: String(e) });
    // Stripe는 5xx로 응답하면 재시도. 멱등 로직이 있으니 5xx 반환 OK.
    return NextResponse.json({ error: { code: "internal" } }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
