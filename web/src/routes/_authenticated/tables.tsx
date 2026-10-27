import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { handsQ, tablesQ, bookQ } from "@/lib/queries";
import { parsePokerNowUrl } from "@/lib/poker";
import { isLocalBot } from "@/lib/local";
import * as bot from "@/lib/bot-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/hud/StatusPill";

export const Route = createFileRoute("/_authenticated/tables")({
  head: () => ({
    meta: [
      { title: "Tables — Feltline" },
      { name: "description", content: "Your Poker Now private tables and their coaching status." },
      { property: "og:title", content: "Tables — Feltline" },
      { property: "og:description", content: "Your private tables." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TablesPage,
});

function TablesPage() {
  const qc = useQueryClient();
  const tables = useQuery(tablesQ);
  const hands = useQuery(handsQ);
  const book = useQuery(bookQ);
  const [url, setUrl] = useState("");
  const [nick, setNick] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const gid = parsePokerNowUrl(url);
    if (!gid) return void toast.error("Paste a Poker Now game link, like https://www.pokernow.club/games/abc123");
    try {
      if (isLocalBot()) await bot.postTable({ pokernow_url: url.trim(), game_id: gid, nickname: nick || gid });
      else {
        const { supabase } = await import("@/integrations/supabase/client");
        const { error } = await supabase.from("tables").insert({ pokernow_url: url.trim(), game_id: gid, nickname: nick || gid, status: "watching" });
        if (error) throw error;
      }
    } catch (e) {
      return void toast.error(e instanceof Error ? e.message : "Could not add table");
    }
    setUrl("");
    setNick("");
    qc.invalidateQueries({ queryKey: ["tables"] });
    toast.success(isLocalBot() ? "Table added. Opening it in the coach will start Chromium." : "Table saved. Open this game in Chrome with the Feltline extension, then open the coach.");
  }

  const list = tables.data ?? [];
  return (
    <div className="space-y-4">
      <form onSubmit={add} className="hud-panel flex flex-col gap-2 p-3 md:flex-row">
        <Input placeholder="https://www.pokernow.club/games/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Input placeholder="Nickname (optional)" className="md:max-w-56" value={nick} onChange={(e) => setNick(e.target.value)} />
        <Button type="submit" variant="take">Add table</Button>
      </form>
      {!isLocalBot() && (
        <p className="text-sm text-muted-foreground">
          Add any private Poker Now link, then{" "}
          <a href="/feltline-extension.zip" download="feltline-extension.zip" className="text-gold underline">
            download the extension zip
          </a>{" "}
          and load it in Chrome.{" "}
          <Link to="/install" className="text-gold underline">
            Install steps
          </Link>
          . The Demo table works with no extension.
        </p>
      )}

      {tables.isLoading ? (
        <p className="text-muted-foreground">Loading tables…</p>
      ) : list.length === 0 ? (
        <div className="hud-panel p-10 text-center text-muted-foreground">
          Paste a private table link. Suggestions only until you turn on auto-play.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((t) => {
            const th = (hands.data ?? []).filter((h) => h.table_id === t.id);
            const last = th[0];
            const seated = last ? (book.data?.hp ?? []).filter((r) => r.hand_id === last.id).length : 0;
            return (
              <Link key={t.id} to="/coach/$tableId" params={{ tableId: t.id }} className="hud-panel block p-4 transition hover:glow-gold">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-display text-xl font-semibold uppercase">{t.nickname ?? t.game_id}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{t.pokernow_url}</p>
                  </div>
                  <StatusPill status={t.status} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <Stat label="Last hand" value={last ? `#${last.hand_number}` : "—"} />
                  <Stat label="Seated" value={String(seated)} />
                  <Stat label="Mode" value={t.status === "autoplay" ? "Auto" : "Suggest"} warn={t.status === "autoplay"} />
                </div>
                {t.is_demo && <p className="mt-3 text-xs text-gold">Demo table · streams a fake hand</p>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded bg-muted px-2 py-1.5">
      <p className="hud-label">{label}</p>
      <p className={warn ? "font-mono font-semibold text-destructive" : "font-mono font-semibold"}>{value}</p>
    </div>
  );
}
