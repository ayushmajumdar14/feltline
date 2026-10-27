import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { handsQ, opponentsQ, useStats } from "@/lib/queries";
import { computeStats } from "@/lib/poker";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/trends")({
  head: () => ({
    meta: [
      { title: "Opponent trends — Feltline" },
      { name: "description", content: "Study how each opponent's tendencies develop hand by hand." },
      { property: "og:title", content: "Opponent trends — Feltline" },
      { property: "og:description", content: "Opponent trends over time." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TrendsPage,
});

const tip = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", fontSize: 12 } };

function TrendsPage() {
  const opps = useQuery(opponentsQ);
  const hands = useQuery(handsQ);
  const { stats, book } = useStats();
  const [sel, setSel] = useState<string | null>(null);
  const id = sel ?? opps.data?.[0]?.id ?? null;

  const order = new Map((hands.data ?? []).map((h) => [h.id, h.hand_number]));
  let series: { hand: string; VPIP: number; PFR: number; "Fold to bet": number; AF: number; chips: number }[] = [];
  if (book && id) {
    const mine = book.hp.filter((r) => r.opponent_id === id).sort((a, b) => (order.get(a.hand_id) ?? 0) - (order.get(b.hand_id) ?? 0));
    const shows = new Set(book.sd.filter((s) => s.opponent_id === id).map((s) => s.hand_id));
    let chips = 0;
    series = mine.map((r, i) => {
      chips += Number(r.won);
      const ids = mine.slice(0, i + 1).map((x) => x.hand_id);
      const set = new Set(ids);
      const s = computeStats(id, ids, book.actions.filter((a) => set.has(a.hand_id)), shows, chips);
      return { hand: `#${order.get(r.hand_id)}`, VPIP: Math.round(s.vpip * 100), PFR: Math.round(s.pfr * 100), "Fold to bet": Math.round(s.foldToBet * 100), AF: +s.af.toFixed(2), chips };
    });
  }
  const compare = (opps.data ?? []).map((o) => {
    const s = stats.get(o.id);
    return { name: o.display_name, VPIP: s ? Math.round(s.vpip * 100) : 0, PFR: s ? Math.round(s.pfr * 100) : 0, "Fold to bet": s ? Math.round(s.foldToBet * 100) : 0 };
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(opps.data ?? []).map((o) => (
          <button key={o.id} onClick={() => setSel(o.id)} className={cn("rounded px-3 py-1.5 font-display text-sm uppercase", id === o.id ? "bg-gold text-gold-foreground" : "bg-muted text-muted-foreground")}>
            {o.display_name}
          </button>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="hud-panel p-4">
          <p className="hud-label">Tendencies as the sample grows (%, blended toward averages early)</p>
          <div className="mt-2 h-64">
            <ResponsiveContainer>
              <LineChart data={series}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="hand" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} domain={[0, 100]} />
                <Tooltip {...tip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="VPIP" stroke="var(--gold)" dot={false} strokeWidth={2} />
                <Line dataKey="PFR" stroke="var(--chart-4)" dot={false} strokeWidth={2} />
                <Line dataKey="Fold to bet" stroke="var(--pip-red)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="hud-panel p-4">
          <p className="hud-label">Chips collected over time</p>
          <div className="mt-2 h-64">
            <ResponsiveContainer>
              <LineChart data={series}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="hand" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                <Tooltip {...tip} />
                <Line dataKey="chips" stroke="var(--success)" dot={false} strokeWidth={2} />
                <Line dataKey="AF" stroke="var(--chart-5)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="hud-panel p-4 lg:col-span-2">
          <p className="hud-label">Side by side</p>
          <div className="mt-2 h-64">
            <ResponsiveContainer>
              <BarChart data={compare}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                <Tooltip {...tip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="VPIP" fill="var(--gold)" />
                <Bar dataKey="PFR" fill="var(--chart-4)" />
                <Bar dataKey="Fold to bet" fill="var(--pip-red)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}
