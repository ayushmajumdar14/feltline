import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy — Feltline" },
      { name: "description", content: "What Feltline and the Chrome extension collect, why, and how to delete it." },
      { property: "og:title", content: "Privacy — Feltline" },
      { property: "og:description", content: "Privacy policy for the Feltline website and Chrome extension." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

export function PrivacyBody() {
  return (
    <div className="space-y-5 text-sm leading-relaxed text-muted-foreground">
      <p>Last updated October 27, 2026.</p>
      <p>
        Feltline is a suggested-action coach for private Poker Now tables. This policy covers the website (
        <a href="https://feltline-ten.vercel.app" className="text-gold underline">
          feltline-ten.vercel.app
        </a>
        ) and the Feltline Chrome extension.
      </p>

      <h2 className="font-display text-lg font-semibold uppercase text-foreground">What we collect</h2>
      <p>
        <strong className="text-foreground">Account.</strong> If you sign up, we store the email and password hash
        (or magic-link token) through Supabase Auth, plus a display name if you give one.
      </p>
      <p>
        <strong className="text-foreground">Workspace.</strong> Tables you add, hands, actions, showdowns, suggestions
        you took or overrode, and opponent notes. Those sit in your private Supabase rows (or a local SQLite file if
        you run the bot yourself).
      </p>
      <p>
        <strong className="text-foreground">Chrome extension.</strong> On a Poker Now game tab it reads the live hand:
        hole cards, board, pot, stacks, bets, whose turn, player display names and Poker Now ids. It keeps a short
        session copy of the last table state so the coach tab can reconnect. That session cache is cleared when Chrome
        closes. The extension does not read table chat, passwords, payment data, location, or your general browsing
        history.
      </p>

      <h2 className="font-display text-lg font-semibold uppercase text-foreground">How it is used</h2>
      <p>
        Table state is sent from the Poker Now tab to the Feltline coach tab in the same Chrome profile so we can
        suggest fold / check / call / bet / raise. Names and ids label seats and build an opponent book (VPIP, PFR,
        fold-to-bet). We do not sell this data, do not use it for ads, and do not run remotely hosted extension code.
      </p>

      <h2 className="font-display text-lg font-semibold uppercase text-foreground">Who can see it</h2>
      <p>
        Your workspace is isolated by row-level security. Other Feltline users cannot read your tables or book. Hosts
        we talk to: Poker Now (the game you already opened), Feltline on Vercel, and Supabase for auth and storage.
        The extension only injects on pokernow.com, pokernow.club, and feltline-ten.vercel.app (plus Feltline preview
        urls).
      </p>

      <h2 className="font-display text-lg font-semibold uppercase text-foreground">Your choices</h2>
      <p>
        In Settings you can export your workspace as JSON or delete tables, opponents, and hands. Signing out of
        Feltline and removing the extension stops collection. Uninstalling the extension removes its session cache.
      </p>

      <h2 className="font-display text-lg font-semibold uppercase text-foreground">Contact</h2>
      <p>
        Questions: open an issue on{" "}
        <a href="https://github.com/ayushmajumdar14/feltline" className="text-gold underline">
          github.com/ayushmajumdar14/feltline
        </a>
        .
      </p>
    </div>
  );
}

function PrivacyPage() {
  return (
    <div className="flex min-h-screen items-center justify-center felt px-4 py-10">
      <div className="hud-panel w-full max-w-2xl space-y-5 p-6">
        <Link to="/" className="font-display text-lg font-bold uppercase tracking-widest text-gold">
          Feltline
        </Link>
        <h1 className="font-display text-3xl font-semibold uppercase">Privacy</h1>
        <PrivacyBody />
        <p className="text-sm text-muted-foreground">
          <Link to="/install" className="text-gold underline">
            Chrome extension
          </Link>
          {" · "}
          <Link to="/settings" className="text-gold underline">
            Settings
          </Link>
        </p>
      </div>
    </div>
  );
}
