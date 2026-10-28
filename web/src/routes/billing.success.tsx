import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { confirmCheckout } from "@/lib/checkout";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/billing/success")({
  validateSearch: (s: Record<string, unknown>) => ({ session_id: typeof s.session_id === "string" ? s.session_id : "" }),
  head: () => ({ meta: [{ title: "Payment received — Feltline" }] }),
  component: SuccessPage,
});

function SuccessPage() {
  const { session_id } = Route.useSearch();
  const [state, setState] = useState<"wait" | "ok" | "err">("wait");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session_id) {
      setState("err");
      setError("Missing checkout session.");
      return;
    }
    confirmCheckout(session_id)
      .then(() => setState("ok"))
      .catch((e) => {
        setState("err");
        setError(e instanceof Error ? e.message : "Could not confirm");
      });
  }, [session_id]);

  return (
    <div className="flex min-h-screen items-center justify-center felt px-4">
      <div className="hud-panel w-full max-w-md space-y-4 p-6 text-center">
        <Link to="/" className="font-display text-lg font-bold uppercase tracking-widest text-gold">
          Feltline
        </Link>
        <h1 className="font-display text-3xl font-semibold uppercase">
          {state === "wait" ? "Confirming…" : state === "ok" ? "You're in" : "Almost"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {state === "wait" && "Stripe is finishing the payment."}
          {state === "ok" && "Live tables are unlocked. Add a Poker Now link and open the coach."}
          {state === "err" && error}
        </p>
        <Button asChild variant="take">
          <Link to="/tables">Go to tables</Link>
        </Button>
      </div>
    </div>
  );
}
