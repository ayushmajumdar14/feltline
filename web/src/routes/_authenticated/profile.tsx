import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";
import { bookQ, handsQ, suggestionsQ } from "@/lib/queries";
import { isLocalBot } from "@/lib/local";
import * as bot from "@/lib/bot-api";
import { computeStats, pct } from "@/lib/poker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LowSample } from "@/components/hud/StatusPill";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "My profile — Feltline" },
      { name: "description", content: "Your Poker Now ID, your own stats and results over time." },
      { property: "og:title", content: "My profile — Feltline" },
      { property: "og:description", content: "Your own trends." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});

const tip = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", fontSize: 12 } };

function ProfilePage() {
  const qc = useQueryClient();
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      if (isLocalBot()) return bot.getProfile() as Promise<{ id: string; display_name: string | null; pokernow_id: string | null; bio: string }>;
      const { supabase } = await import("@/integrations/supabase/client");
      return (await supabase.from("profiles").select("*").maybeSingle()).data;
    },
  });
  const hands = useQuery(handsQ);
  const book = useQuery(bookQ);
  const sugs = useQuery(suggestionsQ);
  const [f, setF] = useState({ display_name: "", pokernow_id: "", bio: "" });
  useEffect(() => {
    if (profile.data) setF({ display_name: profile.data.display_name ?? "", pokernow_id: profile.data.pokernow_id ?? "", bio: profile.data.bio });
  }, [profile.data?.id]);

  async function save() {
    if (!profile.data) return;
    try {
      if (isLocalBot()) await bot.patchProfile({ display_name: f.display_name, pokernow_id: f.pokernow_id || "", bio: f.bio });
      else {
        const { supabase } = await import("@/integrations/supabase/client");
        const { error } = await supabase.from("profiles").update({ display_name: f.display_name, pokernow_id: f.pokernow_id || null, bio: f.bio }).eq("id", profile.data.id);
        if (error) throw error;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
      return;
    }
    toast.success("Profile saved");
    qc.invalidateQueries({ queryKey: ["profile"] });
  }

  const done = (hands.data ?? []).filter((h) => !(h.raw as { live?: boolean }).live).slice().reverse();
  let cum = 0;
  const netSeries = done.map((h) => {
    cum += Number((h.raw as { hero_net?: number }).hero_net ?? 0);
    return { hand: `#${h.hand_number}`, net: cum };
  });
  const me = book.data
    ? computeStats("hero", done.map((h) => h.id), book.data.actions.filter((a) => done.some((h) => h.id === a.hand_id)), new Set(), cum)
    : null;

  const decided = (sugs.data ?? []).filter((s) => s.accepted !== "pending");
  const counts = ["taken", "overridden", "ignored"].map((k) => ({ k, n: decided.filter((s) => s.accepted === k).length }));
  const netBy = (k: string) => {
    const ids = new Set(decided.filter((s) => s.accepted === k).map((s) => s.hand_id));
    const hs = done.filter((h) => ids.has(h.id));
    return hs.length ? Math.round(hs.reduce((a, h) => a + Number((h.raw as { hero_net?: number }).hero_net ?? 0), 0) / hs.length) : 0;
  };
  const adherence = counts.map((c) => ({ name: c.k, hands: c.n, avg: netBy(c.k) }));

  return (
    <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
      <section className="hud-panel space-y-3 p-4">
        <h2 className="font-display text-lg font-semibold uppercase">My profile</h2>
        <div className="space-y-1"><Label htmlFor="dn">Display name</Label><Input id="dn" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></div>
        <div className="space-y-1">
          <Label htmlFor="pn">Poker Now player ID</Label>
          <Input id="pn" placeholder="e.g. a1B2c3D4" value={f.pokernow_id} onChange={(e) => setF({ ...f, pokernow_id: e.target.value })} />
          <p className="text-[11px] text-muted-foreground">Used to recognise you as hero in hand logs from the extension.</p>
        </div>
        <div className="space-y-1"><Label htmlFor="bio">Study notes</Label><Textarea id="bio" rows={4} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} /></div>
        <Button variant="take" onClick={save}>Save profile</Button>
      </section>

      <div className="space-y-3">
        <section className="hud-panel p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold uppercase">My stats</h2>
            {me?.lowSample && <LowSample hands={me.hands} />}
          </div>
          {me && (
            <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {([["Hands", String(me.hands)], ["VPIP", pct(me.vpip)], ["PFR", pct(me.pfr)], ["AF", me.af.toFixed(1)], ["Fold to bet", pct(me.foldToBet)], ["Net", String(cum)]] as const).map(([k, v]) => (
                <div key={k} className="rounded bg-muted px-2 py-1.5"><p className="hud-label">{k}</p><p className="font-mono font-semibold">{v}</p></div>
              ))}
            </div>
          )}
        </section>
        <section className="hud-panel p-4">
          <p className="hud-label">Cumulative result (chips)</p>
          <div className="mt-2 h-56">
            <ResponsiveContainer>
              <LineChart data={netSeries}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="hand" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                <Tooltip {...tip} />
                <Line type="monotone" dataKey="net" stroke="var(--gold)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="hud-panel p-4">
          <p className="hud-label">Suggestions: how often you followed, and average result per hand</p>
          <div className="mt-2 h-48">
            <ResponsiveContainer>
              <BarChart data={adherence}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                <Tooltip {...tip} />
                <Bar dataKey="hands" fill="var(--gold)" />
                <Bar dataKey="avg" fill="var(--success)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground">Gold = hands, green = average chips per hand. Small samples swing a lot.</p>
        </section>
      </div>
    </div>
  );
}
