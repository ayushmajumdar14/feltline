import { createFileRoute } from "@tanstack/react-router";
import { checkoutLine, siteUrl, stripeClient } from "@/lib/stripe-server";

async function userFromRequest(request: Request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return null;
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await supabase.auth.getUser(token);
  return data.user;
}

export const Route = createFileRoute("/api/stripe/checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await userFromRequest(request);
        if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
        const body = (await request.json().catch(() => ({}))) as { plan?: string };
        const plan = body.plan;
        if (plan !== "monthly" && plan !== "yearly" && plan !== "lifetime") {
          return Response.json({ error: "Pick monthly, yearly, or lifetime." }, { status: 400 });
        }
        try {
          const stripe = stripeClient();
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const existing = await supabaseAdmin.from("billing").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
          const spec = checkoutLine(plan);
          const session = await stripe.checkout.sessions.create({
            ...spec,
            customer: existing.data?.stripe_customer_id || undefined,
            customer_email: existing.data?.stripe_customer_id ? undefined : user.email || undefined,
            client_reference_id: user.id,
            metadata: { user_id: user.id, plan },
            subscription_data: plan === "lifetime" ? undefined : { metadata: { user_id: user.id, plan } },
            success_url: `${siteUrl()}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${siteUrl()}/pricing`,
            allow_promotion_codes: true,
          });
          return Response.json({ url: session.url });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Could not start checkout";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
