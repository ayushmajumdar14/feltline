import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PLANS } from "@/lib/billing";
import { startCheckout } from "@/lib/checkout";
import { isLocalBot } from "@/lib/local";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Feltline" },
      { name: "description", content: "$3/month, $25/year, or $50 lifetime for live Poker Now coaching." },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  const [signedIn, setSignedIn] = useState(isLocalBot());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (isLocalBot()) return;
    import("@/integrations/supabase/client").then(({ supabase }) =>
      supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session)),
    );
  }, []);

  async function buy(plan: "monthly" | "yearly" | "lifetime") {
    if (!signedIn) {
      window.location.href = "/auth";
      return;
    }
    setBusy(plan);
    try {
      await startCheckout(plan);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start checkout");
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center felt px-4 py-10">
      <div className="w-full max-w-3xl space-y-6">
        <div className="text-center">
          <Link to="/" className="font-display text-lg font-bold uppercase tracking-widest text-gold">
            Feltline
          </Link>
          <h1 className="mt-3 font-display text-4xl font-semibold uppercase">Live coach plans</h1>
          <p className="mt-2 text-sm text-muted-foreground">Demo table is free. Live Poker Now tables need a plan. You still confirm every click.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.id} className="hud-panel space-y-3 p-5">
              <p className="font-display text-lg font-semibold uppercase">{p.name}</p>
              <p className="font-display text-4xl font-bold text-gold">{p.price}</p>
              <p className="text-sm text-muted-foreground">{p.detail}</p>
              <Button variant="take" className="w-full" disabled={!!busy} onClick={() => buy(p.id)}>
                {busy === p.id ? "Opening Stripe…" : signedIn ? `Pay ${p.price}` : "Sign in to pay"}
              </Button>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Card charges go through Stripe.{" "}
          <a href="/privacy" className="text-gold underline">
            Privacy
          </a>
        </p>
      </div>
    </div>
  );
}
