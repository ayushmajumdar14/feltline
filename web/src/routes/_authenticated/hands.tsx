import { createFileRoute, Link, Outlet, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { bookQ, handsQ, opponentsQ, suggestionsQ, tablesQ } from "@/lib/queries";
import { formatSuggestion } from "@/lib/poker";
import { PlayingCard } from "@/components/hud/PlayingCard";
import { Input } from "@/components/ui/input";

type Search = { table?: string | undefined; opponent?: string | undefined; date?: string | undefined };

export const Route = createFileRoute("/_authenticated/hands")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    table: typeof s["table"] === "string" ? s["table"] : undefined,
    opponent: typeof s["opponent"] === "string" ? s["opponent"] : undefined,
    date: typeof s["date"] === "string" ? s["date"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Hands — Feltline" },
      { name: "description", content: "Replay your hands and compare the suggestion with what you did." },
      { property: "og:title", content: "Hands — Feltline" },
      { property: "og:description", content: "Hand history and replay." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HandsPage,
});

const ACC: Record<string, string> = { taken: "text-success", overridden: "text-warning", ignored: "text-muted-foreground", pending: "text-gold" };

function HandsPage() {
  const matchRoute = useMatchRoute();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/hands" });
  const hands = useQuery(handsQ);
  const tables = useQuery(tablesQ);
  const opps = useQuery(opponentsQ);
  const sugs = useQuery(suggestionsQ);
  const book = useQuery(bookQ);
  if (matchRoute({ to: "/hands/$handId" })) return <Outlet />;

  const withOpp = search.opponent ? new Set((book.data?.hp ?? []).filter((r) => r.opponent_id === search.opponent).map((r) => r.hand_id)) : null;
  const list = (hands.data ?? []).filter(
    (h) =>
      (!search.table || h.table_id === search.table) &&
      (!withOpp || withOpp.has(h.id)) &&
      (!search.date || h.started_at.slice(0, 10) === search.date),
  );
  const set = (patch: Partial<Search>) => navigate({ search: (s: Search) => ({ ...s, ...patch }) });
  const sel = "h-9 rounded-md border bg-background px-2 text-sm";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select className={sel} value={search.table ?? ""} onChange={(e) => set({ table: e.target.value || undefined })}>
          <option value="">All tables</option>
          {(tables.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.nickname ?? t.game_id}</option>)}
        </select>
        <select className={sel} value={search.opponent ?? ""} onChange={(e) => set({ opponent: e.target.value || undefined })}>
          <option value="">All opponents</option>
          {(opps.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.display_name}</option>)}
        </select>
        <Input type="date" className="w-44" value={search.date ?? ""} onChange={(e) => set({ date: e.target.value || undefined })} />
      </div>
      <div className="hud-panel divide-y">
        {list.map((h) => {
          const raw = h.raw as { hero_net?: number; live?: boolean };
          const s = (sugs.data ?? []).filter((x) => x.hand_id === h.id);
          return (
            <Link key={h.id} to="/hands/$handId" params={{ handId: h.id }} className="flex flex-wrap items-center gap-3 px-3 py-2.5 hover:bg-accent">
              <span className="w-14 font-mono text-sm text-muted-foreground">#{h.hand_number}</span>
              <div className="flex gap-0.5">{h.board.map((c) => <PlayingCard key={c} card={c} size="sm" />)}</div>
              <span className={"w-16 font-mono text-sm " + (raw.live ? "text-gold" : Number(raw.hero_net ?? 0) >= 0 ? "text-success" : "text-destructive")}>
                {raw.live ? "live" : `${Number(raw.hero_net ?? 0) >= 0 ? "+" : ""}${raw.hero_net ?? 0}`}
              </span>
              <span className="ml-auto flex flex-wrap gap-3 text-xs">
                {s.map((x) => (
                  <span key={x.id}>
                    <span className="text-muted-foreground">{x.street}: </span>
                    {formatSuggestion(x.suggested_action, x.size)}
                    <span className={"ml-1 uppercase " + ACC[x.accepted]}>{x.accepted}{x.actual_action && x.accepted === "overridden" ? ` → ${x.actual_action}` : ""}</span>
                  </span>
                ))}
              </span>
            </Link>
          );
        })}
        {list.length === 0 && <p className="p-8 text-center text-muted-foreground">No hands match these filters.</p>}
      </div>
    </div>
  );
}
