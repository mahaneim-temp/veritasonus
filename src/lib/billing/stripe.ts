import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function stripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  _stripe = new Stripe(key, {
    apiVersion: "2024-06-20",
    appInfo: { name: "lucid-interpret", version: "0.1.0" },
  });
  return _stripe;
}

export function priceIdFor(plan: "pro_monthly" | "pro_yearly"): string {
  const id =
    plan === "pro_monthly"
      ? process.env.STRIPE_PRICE_PRO_MONTHLY
      : process.env.STRIPE_PRICE_PRO_YEARLY;
  if (!id) throw new Error(`Stripe price id not configured for ${plan}`);
  return id;
}
