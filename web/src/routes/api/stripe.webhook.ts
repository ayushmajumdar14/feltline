import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";
import { applyPaidPlan, planFromSession, stripeClient, userIdForCustomer } from "@/lib/stripe-server";

async function fromCheckout(session: Stripe.Checkout.Session) {
  const userId = session.client_reference_id || session.metadata?.user_id;
  if (!userId) return;
  const plan = planFromSession(session);
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  let expiresAt: string | null = null;
  if (subscriptionId) {
    const sub = await stripeClient().subscriptions.retrieve(subscriptionId);
    expiresAt = new Date(sub.current_period_end * 1000).toISOString();
  }
  await applyPaidPlan({
    userId,
    plan,
    status: "active",
    customerId,
    subscriptionId: subscriptionId ?? null,
    expiresAt,
  });
}

async function fromSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = sub.metadata?.user_id || (await userIdForCustomer(customerId));
  if (!userId) return;
  const interval = sub.items.data[0]?.price?.recurring?.interval;
  const plan = interval === "year" ? "yearly" : "monthly";
  const status = sub.status === "active" || sub.status === "trialing" ? "active" : sub.status === "past_due" ? "past_due" : "canceled";
  await applyPaidPlan({
    userId,
    plan,
    status,
    customerId,
    subscriptionId: sub.id,
    expiresAt: new Date(sub.current_period_end * 1000).toISOString(),
  });
}

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const signature = request.headers.get("stripe-signature");
        const secret = process.env["STRIPE_WEBHOOK_SECRET"];
        if (!signature || !secret) return new Response("Webhook is not configured", { status: 400 });
        const raw = await request.text();
        let event: Stripe.Event;
        try {
          event = stripeClient().webhooks.constructEvent(raw, signature, secret);
        } catch {
          return new Response("Invalid signature", { status: 400 });
        }
        try {
          if (event.type === "checkout.session.completed") await fromCheckout(event.data.object as Stripe.Checkout.Session);
          if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
            await fromSubscription(event.data.object as Stripe.Subscription);
          }
          if (event.type === "invoice.payment_failed") {
            const invoice = event.data.object as Stripe.Invoice;
            const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
            if (customerId) {
              const userId = await userIdForCustomer(customerId);
              if (userId) {
                const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
                await supabaseAdmin.from("billing").update({ plan_status: "past_due", updated_at: new Date().toISOString() }).eq("user_id", userId);
              }
            }
          }
        } catch (e) {
          console.error(e);
          return new Response("Handler failed", { status: 500 });
        }
        return new Response("ok", { status: 200 });
      },
    },
  },
});
