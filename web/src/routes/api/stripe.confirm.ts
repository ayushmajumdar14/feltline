import { createFileRoute } from "@tanstack/react-router";
import { applyPaidPlan, planFromSession, stripeClient } from "@/lib/stripe-server";

export const Route = createFileRoute("/api/stripe/confirm")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { session_id?: string };
        if (!body.session_id) return Response.json({ error: "Missing session" }, { status: 400 });
        try {
          const session = await stripeClient().checkout.sessions.retrieve(body.session_id);
          if (session.payment_status !== "paid" && session.status !== "complete") {
            return Response.json({ error: "Payment is not complete yet." }, { status: 400 });
          }
          const userId = session.client_reference_id || session.metadata?.user_id;
          if (!userId) return Response.json({ error: "No user on this session." }, { status: 400 });
          await applyPaidPlan({
            userId,
            plan: planFromSession(session),
            status: "active",
            customerId: typeof session.customer === "string" ? session.customer : session.customer?.id,
            subscriptionId: typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null,
          });
          return Response.json({ ok: true });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "Could not confirm" }, { status: 500 });
        }
      },
    },
  },
});
