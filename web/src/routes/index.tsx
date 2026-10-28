import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { isLocalBot } from "@/lib/local";
import { Button } from "@/components/ui/button";
import { PlayingCard } from "@/components/hud/PlayingCard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Feltline — suggested actions for Poker Now private tables" },
      {
        name: "description",
        content: "A calm HUD that shows a suggested action, a reason and a confidence. You confirm every move.",
      },
      { property: "og:title", content: "Feltline" },
      { property: "og:description", content: "Suggested actions for Poker Now private tables. You always confirm." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const [signedIn, setSignedIn] = useState(isLocalBot());
  useEffect(() => {
    if (isLocalBot()) return;
    import("@/integrations/supabase/client").then(({ supabase }) =>
      supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session)),
    );
  }, []);

  return (
    <div className="min-h-screen felt">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <span className="font-display text-xl font-bold uppercase tracking-widest text-gold">Feltline</span>
        <Button asChild variant="outline" size="sm">
          <Link to={signedIn ? "/tables" : "/auth"}>{signedIn ? "Open my tables" : "Sign in"}</Link>
        </Button>
      </header>
      <main className="mx-auto grid max-w-5xl gap-10 px-5 pb-16 pt-8 md:grid-cols-2 md:items-center md:pt-20">
        <div>
          <p className="hud-label">For Poker Now private tables</p>
          <h1 className="mt-3 font-display text-5xl font-bold uppercase leading-[0.95] md:text-6xl">
            A suggested action.
            <br />
            <span className="text-gold">You decide.</span>
          </h1>
          <p className="mt-5 max-w-md text-muted-foreground">
            Feltline reads the hand, shows one suggested action with a plain reason and a confidence, and keeps a
            private book of the players you face. Nothing is clicked for you unless you turn on auto-play for a table
            where everyone agreed.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild variant="take" size="lg">
              <Link to={signedIn ? "/tables" : "/auth"}>{signedIn ? "Go to tables" : "Create workspace"}</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/install">Get the Chrome extension</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Not a casino. No real-money wallet. No public rooms.{" "}
            <Link to="/privacy" className="text-gold underline">
              Privacy
            </Link>
          </p>
        </div>
        <div className="hud-panel glow-gold p-6">
          <p className="hud-label">Suggested action · Flop</p>
          <div className="mt-3 flex gap-2">
            <PlayingCard card="Kd" />
            <PlayingCard card="7c" />
            <PlayingCard card="2h" />
          </div>
          <p className="mt-5 font-display text-4xl font-bold uppercase text-gold">Bet 24</p>
          <p className="mt-2 text-sm text-muted-foreground">Range c-bet, dry board. Bet 66% pot.</p>
          <div className="mt-4 h-2 overflow-hidden rounded bg-muted">
            <div className="h-full w-[71%] bg-gold" />
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">Confidence 71%</p>
        </div>
      </main>
    </div>
  );
}
