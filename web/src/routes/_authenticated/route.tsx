import { createFileRoute, redirect, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tablesQ, useSetTableStatus } from "@/lib/queries";
import { isLocalBot } from "@/lib/local";
import { Button } from "@/components/ui/button";
import { LogOut, OctagonX } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    if (isLocalBot()) return { user: { id: "local" } };
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: Shell,
});

const NAV = [
  { to: "/tables", label: "Tables" },
  { to: "/opponents", label: "Opponents" },
  { to: "/trends", label: "Trends" },
  { to: "/hands", label: "Hands" },
  { to: "/profile", label: "Profile" },
  { to: "/settings", label: "Settings" },
] as const;

function Shell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tables = useQuery(tablesQ);
  const setStatus = useSetTableStatus();
  const auto = (tables.data ?? []).filter((t) => t.status === "autoplay");

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    if (!isLocalBot()) {
      const { supabase } = await import("@/integrations/supabase/client");
      await supabase.auth.signOut();
    }
    navigate({ to: isLocalBot() ? "/tables" : "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      {auto.length > 0 && (
        <div role="alert" className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-destructive px-4 py-2 text-destructive-foreground">
          <p className="text-sm font-semibold">
            Auto-play is ON for {auto.map((t) => t.nickname ?? t.game_id).join(", ")}. The assistant will act for you on
            this private table. You can stop it instantly.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-destructive-foreground bg-transparent text-destructive-foreground hover:bg-destructive-foreground hover:text-destructive"
            onClick={() => auto.forEach((t) => setStatus.mutate({ id: t.id, status: "suggesting" }))}
          >
            <OctagonX /> Turn off auto-play
          </Button>
        </div>
      )}
      <header className="border-b bg-sidebar">
        <div className="mx-auto flex max-w-[1500px] items-center gap-4 overflow-x-auto px-4 py-2.5">
          <Link to="/tables" className="shrink-0 font-display text-lg font-bold uppercase tracking-widest text-gold">
            Feltline
          </Link>
          <nav className="flex gap-1">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="rounded px-3 py-1.5 font-display text-sm uppercase tracking-wider text-muted-foreground hover:text-foreground"
                activeProps={{ className: "bg-accent text-foreground" }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          {!isLocalBot() && (
            <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={signOut}>
              <LogOut /> Sign out
            </Button>
          )}
          {isLocalBot() && <span className="ml-auto font-mono text-[11px] text-muted-foreground">Local bot</span>}
          <a href="/pricing" className="shrink-0 font-display text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
            Plan
          </a>
          <Link to="/privacy" className="shrink-0 font-display text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
            Privacy
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] p-3 md:p-4">
        <Outlet />
      </main>
    </div>
  );
}
