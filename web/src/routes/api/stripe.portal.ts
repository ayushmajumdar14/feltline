import { createFileRoute } from "@tanstack/react-router";
import { siteUrl, stripeClient } from "@/lib/stripe-server";

export const Route = createFileRoute("/api/stripe/portal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const header = request.headers.get("authorization") || "";
        const token = header.startsWith("Bearer ") ? header.slice(7) : "";
        if (!token) return Response.json({ error: "Sign in first." }, { status: 401 });
        const { createClient } = await import("@supabase/supabase-js");
        const url = process.env["SUPABASE_URL"];
        const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
        if (!url || !key) return Response.json({ error: "Auth is not configured." }, { status: 500 });
        const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data } = await supabase.auth.getUser(token);
        if (!data.user) return Response.json({ error: "Sign in first." }, { status: 401 });
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const row = await supabaseAdmin.from("billing").select("stripe_customer_id").eq("user_id", data.user.id).maybeSingle();
          if (!row.data?.stripe_customer_id) return Response.json({ error: "No Stripe customer yet. Buy a plan first." }, { status: 400 });
          const session = await stripeClient().billingPortal.sessions.create({
            customer: row.data.stripe_customer_id,
            return_url: `${siteUrl()}/settings`,
          });
          return Response.json({ url: session.url });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "Could not open portal" }, { status: 500 });
        }
      },
    },
  },
});
