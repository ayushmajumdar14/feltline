import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { opponentsQ, useStats } from "@/lib/queries";
import { pct } from "@/lib/poker";
import { Input } from "@/components/ui/input";
import { LowSample } from "@/components/hud/StatusPill";

export const Route = createFileRoute("/_authenticated/opponents")({
  head: () => ({
    meta: [
      { title: "Opponents — Feltline" },
      { name: "description", content: "Everyone you have faced, with stats from your own hands only." },
      { property: "og:title", content: "Opponents — Feltline" },
      { property: "og:description", content: "Your private opponent book." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OpponentsPage,
});

function OpponentsPage() {
  const matchRoute = useMatchRoute();
  const child = matchRoute({ to: "/opponents/$opponentId" });
  const opponents = useQuery(opponentsQ);
  const { stats } = useStats();
  const [q, setQ] = useState("");
  if (child) return <Outlet />;
  const list = (opponents.data ?? []).filter((o) => o.display_name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-3">
      <Input placeholder="Search opponents" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      <div className="hud-panel overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b text-left">
              {["Name", "Account", "Hands", "VPIP", "PFR", "3-bet", "AF", "Fold to bet", "Last seen"].map((h) => (
                <th key={h} className="hud-label px-3 py-2 font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {list.map((o) => {
              const s = stats.get(o.id);
              return (
                <tr key={o.id} className="border-b last:border-0 hover:bg-accent">
                  <td className="px-3 py-2 font-sans font-semibold">
                    <Link to="/opponents/$opponentId" params={{ opponentId: o.id }} className="text-gold hover:underline">{o.display_name}</Link>
                    {s?.lowSample && <span className="ml-2"><LowSample hands={s.hands} /></span>}
                  </td>
                  <td className="px-3 py-2">{o.is_account ? "yes" : "guest"}</td>
                  <td className="px-3 py-2">{s?.hands ?? 0}</td>
                  <td className="px-3 py-2">{s ? pct(s.vpip) : "—"}</td>
                  <td className="px-3 py-2">{s ? pct(s.pfr) : "—"}</td>
                  <td className="px-3 py-2">{s ? pct(s.threeBet) : "—"}</td>
                  <td className="px-3 py-2">{s ? s.af.toFixed(1) : "—"}</td>
                  <td className="px-3 py-2">{s ? pct(s.foldToBet) : "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{new Date(o.last_seen).toLocaleDateString()}</td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center font-sans text-muted-foreground">No opponents yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
