import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { opponentsQ } from "@/lib/queries";
import { isLocalBot } from "@/lib/local";
import * as bot from "@/lib/bot-api";
import { formatSuggestion } from "@/lib/poker";
import { PlayingCard } from "@/components/hud/PlayingCard";

export const Route = createFileRoute("/_authenticated/hands/$handId")({
  head: () => ({
    meta: [
      { title: "Hand replay — Feltline" },
      { name: "description", content: "Action timeline and the suggestion shown for this hand." },
      { property: "og:title", content: "Hand replay — Feltline" },
      { property: "og:description", content: "Hand replay." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HandPage,
});

function HandPage() {
  const { handId } = Route.useParams();
  const opps = useQuery(opponentsQ);
  const q = useQuery({
    queryKey: ["hand", handId],
    queryFn: async () => {
      if (isLocalBot()) {
        const data = await bot.getHand(handId);
        return { hand: data.hand, actions: data.actions ?? [], sugs: data.sugs ?? [], sd: data.sd ?? [] } as { hand: { id: string; hand_number: number; board: string[]; raw: Record<string, unknown> }; actions: { id: string; actor: string; action: string; amount: number | null; street: string; facing: string }[]; sugs: { id: string; street: string; suggested_action: string; size: number | null; reason: string; confidence: number; accepted: string; actual_action: string | null; actual_size: number | null }[]; sd: { id: string; opponent_id: string; cards: string[] }[] };
      }
      const { supabase } = await import("@/integrations/supabase/client");
      const [h, a, s, sd] = await Promise.all([
        supabase.from("hands").select("*").eq("id", handId).maybeSingle(),
        supabase.from("actions").select("*").eq("hand_id", handId).order("seq"),
        supabase.from("suggestions").select("*").eq("hand_id", handId).order("created_at"),
        supabase.from("showdowns").select("*").eq("hand_id", handId),
      ]);
      return { hand: h.data, actions: a.data ?? [], sugs: s.data ?? [], sd: sd.data ?? [] };
    },
  });
  const name = (id: string) => (id === "hero" ? "Hero" : opps.data?.find((o) => o.id === id)?.display_name ?? "?");
  if (q.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  const hand = q.data?.hand;
  if (!hand) return <p className="text-muted-foreground">Hand not found.</p>;
  const raw = hand.raw as { hero_cards?: string[]; hero_net?: number; pot?: number };
  const streets = ["preflop", "flop", "turn", "river"];

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <Link to="/hands" className="text-sm text-gold hover:underline">← All hands</Link>
      <div className="hud-panel felt flex flex-wrap items-center gap-4 p-4">
        <p className="font-display text-2xl font-semibold uppercase">Hand #{hand.hand_number}</p>
        <div className="flex gap-1">{(raw.hero_cards ?? []).map((c) => <PlayingCard key={c} card={c} />)}</div>
        <div className="flex gap-1">{hand.board.map((c) => <PlayingCard key={c} card={c} />)}</div>
        <p className="ml-auto font-mono">Hero {Number(raw.hero_net ?? 0) >= 0 ? "+" : ""}{raw.hero_net ?? 0}</p>
      </div>
      {streets.map((st) => {
        const acts = q.data!.actions.filter((a) => a.street === st);
        const sugs = q.data!.sugs.filter((s) => s.street === st);
        if (!acts.length && !sugs.length) return null;
        return (
          <div key={st} className="hud-panel p-4">
            <p className="hud-label">{st}</p>
            {sugs.map((s) => (
              <div key={s.id} className="mt-2 rounded border border-gold/40 bg-gold/10 p-2.5 text-sm">
                <p>
                  <span className="hud-label">Suggested action </span>
                  <span className="font-display text-lg font-semibold text-gold">{formatSuggestion(s.suggested_action, s.size)}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{Math.round(Number(s.confidence))}%</span>
                </p>
                <p className="text-muted-foreground">{s.reason}</p>
                <p className="mt-1 text-xs uppercase">
                  {s.accepted}
                  {s.actual_action ? ` · you: ${formatSuggestion(s.actual_action, s.actual_size)}` : ""}
                </p>
              </div>
            ))}
            <ol className="mt-2 space-y-1 font-mono text-sm">
              {acts.map((a) => (
                <li key={a.id}>
                  <span className={a.actor === "hero" ? "text-gold" : ""}>{name(a.actor)}</span> {a.action}
                  {a.amount ? ` ${a.amount}` : ""}
                  <span className="text-xs text-muted-foreground"> (facing {a.facing})</span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
      {q.data!.sd.length > 0 && (
        <div className="hud-panel p-4">
          <p className="hud-label">Showdown</p>
          {q.data!.sd.map((s) => (
            <div key={s.id} className="mt-2 flex items-center gap-2">
              <span className="w-24">{name(s.opponent_id)}</span>
              {s.cards.map((c) => <PlayingCard key={c} card={c} size="sm" />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
