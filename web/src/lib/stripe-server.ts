import Stripe from "stripe";
import type { PlanId } from "./billing";
import { PLANS } from "./billing";

export function stripeClient() {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY on Vercel.");
  return new Stripe(key);
}

export function siteUrl() {
  return (process.env["SITE_URL"] || "https://feltline-ten.vercel.app").replace(/\/+$/, "");
}

export function checkoutLine(plan: Exclude<PlanId, "free">) {
  const spec = PLANS.find((p) => p.id === plan);
  if (!spec) throw new Error("Unknown plan");
  if (spec.interval) {
    return {
      mode: "subscription" as const,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: spec.cents,
            recurring: { interval: spec.interval },
            product_data: { name: `Feltline ${spec.name}` },
          },
        },
      ],
    };
  }
  return {
    mode: "payment" as const,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: spec.cents,
          product_data: { name: "Feltline Lifetime" },
        },
      },
    ],
  };
}

export function planFromSession(session: Stripe.Checkout.Session): Exclude<PlanId, "free"> {
  const meta = session.metadata?.["plan"];
  if (meta === "monthly" || meta === "yearly" || meta === "lifetime") return meta;
  return session.mode === "subscription" ? "monthly" : "lifetime";
}

export async function applyPaidPlan(opts: {
  userId: string;
  plan: Exclude<PlanId, "free">;
  status: "active" | "canceled" | "past_due";
  customerId?: string | null;
  subscriptionId?: string | null;
  expiresAt?: string | null;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("billing").upsert({
    user_id: opts.userId,
    plan: opts.plan,
    plan_status: opts.status,
    stripe_customer_id: opts.customerId ?? null,
    stripe_subscription_id: opts.subscriptionId ?? null,
    plan_expires_at: opts.expiresAt ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function userIdForCustomer(customerId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("billing").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
  return data?.user_id ?? null;
}
