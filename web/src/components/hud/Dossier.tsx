import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { opponentsQ, useStats } from "@/lib/queries";
import { isLocalBot } from "@/lib/local";
import * as bot from "@/lib/bot-api";
import { pct } from "@/lib/poker";
import { PlayingCard } from "@/components/hud/PlayingCard";
import { LowSample } from "@/components/hud/StatusPill";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function Dossier({ opponentId }: { opponentId: string }) {
  const qc = useQueryClient();
  const opponents = useQuery(opponentsQ);
  const { stats, book } = useStats();
  const o = opponents.data?.find((x) => x.id === opponentId);
  const s = stats.get(opponentId);
  const [notes, setNotes] = useState(o?.notes ?? "");
  useEffect(() => setNotes(o?.notes ?? ""), [o?.id, o?.notes]);

  const shown = useQuery({
    queryKey: ["shown", opponentId],
    queryFn: async () => {
      if (isLocalBot()) return (await bot.getShowdowns(opponentId)) as { cards: string[]; hands: { hand_number: number; board: string[] } | null }[];
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase.from("showdowns").select("cards, hands(hand_number, board)").eq("opponent_id", opponentId).limit(10);
      return data ?? [];
    },
  });

  if (!o) return null;
  async function save() {
    try {
      if (isLocalBot()) await bot.patchOpponent(opponentId, notes);
      else {
        const { supabase } = await import("@/integrations/supabase/client");
        const { error } = await supabase.from("opponents").update({ notes }).eq("id", opponentId);
        if (error) throw error;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
      return;
    }
    toast.success("Notes saved");
    qc.invalidateQueries({ queryKey: ["opponents"] });
  }
  const rows: [string, string][] = s
    ? [
        ["Hands", String(s.hands)],
        ["VPIP", pct(s.vpip)],
        ["PFR", pct(s.pfr)],
        ["3-bet", pct(s.threeBet)],
        ["AF", s.af.toFixed(1)],
        ["Fold to bet", pct(s.foldToBet)],
        ["C-bet", pct(s.cbet)],
        ["WTSD", pct(s.wtsd)],
        ["Chips won", String(s.chips)],
      ]
    : [];
  void book;
  return (
    <div className="hud-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-display text-2xl font-semibold uppercase">{o.display_name}</p>
          <p className="font-mono text-xs text-muted-foreground">{o.player_id} · {o.is_account ? "account" : "guest"}</p>
        </div>
        {s?.lowSample && <LowSample hands={s.hands} />}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="rounded bg-muted px-2 py-1.5">
            <p className="hud-label">{k}</p>
            <p className="font-mono text-sm font-semibold">{v}</p>
          </div>
        ))}
      </div>
      {s?.lowSample && <p className="mt-2 text-[11px] text-muted-foreground">Stats are blended toward population averages until 20 hands.</p>}
      <p className="hud-label mt-4">Last shown hands</p>
      <ul className="mt-1 space-y-1">
        {(shown.data ?? []).length === 0 && <li className="text-sm text-muted-foreground">Nothing shown yet</li>}
        {(shown.data ?? []).map((r, i) => {
          const h = r.hands as unknown as { hand_number: number; board: string[] } | null;
          return (
            <li key={i} className="flex items-center gap-2">
              <span className="w-10 font-mono text-xs text-muted-foreground">#{h?.hand_number}</span>
              <div className="flex gap-0.5">{r.cards.map((c) => <PlayingCard key={c} card={c} size="sm" />)}</div>
              <div className="ml-auto flex gap-0.5 opacity-80">{(h?.board ?? []).map((c) => <PlayingCard key={c} card={c} size="sm" />)}</div>
            </li>
          );
        })}
      </ul>
      <p className="hud-label mt-4">Notes</p>
      <Textarea className="mt-1" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <Button size="sm" variant="outline" className="mt-2" onClick={save}>Save notes</Button>
    </div>
  );
}
