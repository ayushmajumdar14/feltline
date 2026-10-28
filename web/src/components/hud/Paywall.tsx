import { PLANS } from "@/lib/billing";
import { startCheckout } from "@/lib/checkout";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";

export function Paywall({ compact }: { compact?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function buy(plan: "monthly" | "yearly" | "lifetime") {
    setBusy(plan);
    try {
      await startCheckout(plan);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start checkout");
      setBusy(null);
    }
  }

  return (
    <div className={compact ? "hud-panel mx-auto max-w-2xl space-y-4 p-6" : "hud-panel space-y-5 p-6"}>
      <div>
        <p className="hud-label">Feltline live</p>
        <h2 className="font-display text-2xl font-semibold uppercase">Unlock live tables</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The demo table stays free. A paid plan is required to coach a real Poker Now table. You still confirm every
          action unless auto-play is on.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {PLANS.map((p) => (
          <div key={p.id} className="rounded bg-muted p-4">
            <p className="font-display text-lg font-semibold uppercase">{p.name}</p>
            <p className="mt-1 font-display text-3xl font-bold text-gold">{p.price}</p>
            <p className="mt-1 text-xs text-muted-foreground">{p.detail}</p>
            <Button className="mt-3 w-full" variant="take" disabled={!!busy} onClick={() => buy(p.id)}>
              {busy === p.id ? "Opening Stripe…" : `Get ${p.name}`}
            </Button>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Checkout is Stripe.{" "}
        <a href="/privacy" className="text-gold underline">
          Privacy
        </a>
        {" · "}
        <a href="/pricing" className="text-gold underline">
          All plans
        </a>
      </p>
    </div>
  );
}
