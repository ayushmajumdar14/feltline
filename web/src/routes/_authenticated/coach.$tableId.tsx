import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { opponentsQ, settingsQ, tablesQ, useSetTableStatus, useStats } from "@/lib/queries";
import { ACTIONS, autoplayDelayMs, formatSuggestion, pct, type Action } from "@/lib/poker";
import { advanceDemo, dealNextDemoHand } from "@/lib/demo-stream";
import { emitHud, HUD_SOURCE } from "@/lib/hud-events";
import { isLocalBot } from "@/lib/local";
import * as bot from "@/lib/bot-api";
import { PlayingCard } from "@/components/hud/PlayingCard";
import { LowSample, StatusPill } from "@/components/hud/StatusPill";
import { AutoplayDialog } from "@/components/hud/AutoplayDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dossier } from "@/components/hud/Dossier";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/coach/$tableId")({
  head: () => ({
    meta: [
      { title: "Live coach — Feltline" },
      { name: "description", content: "Suggested action, table context and opponent dossier for your private table." },
      { property: "og:title", content: "Live coach — Feltline" },
      { property: "og:description", content: "Suggested action HUD." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CoachPage,
});

type Raw = { hero_cards?: string[]; pot?: number; live?: boolean; street?: string; hero_stack?: number; hero_net?: number };

function CoachPage() {
  const { tableId } = Route.useParams();
  const qc = useQueryClient();
  const tables = useQuery(tablesQ);
  const settings = useQuery(settingsQ);
  const opponents = useQuery(opponentsQ);
  const { stats } = useStats();
  const setStatus = useSetTableStatus();
  const table = tables.data?.find((t) => t.id === tableId);

  const live = useQuery({
    queryKey: ["live", tableId],
    refetchInterval: isLocalBot() ? 1500 : false,
    queryFn: async () => {
      if (isLocalBot()) {
        const data = await bot.getLive(tableId);
        if (!data) return null;
        return data as { hand: { id: string; hand_number: number; board: string[]; raw: Raw }; players: { id: string; opponent_id: string; seat: number; stack: number }[]; actions: { actor: string; action: string; amount: number | null; street: string }[]; suggestions: { id: string; accepted: string; suggested_action: string; size: number | null; reason: string; confidence: number }[] };
      }
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: hand } = await supabase.from("hands").select("*").eq("table_id", tableId).order("hand_number", { ascending: false }).limit(1).maybeSingle();
      if (!hand) return null;
      const [hp, acts, sug] = await Promise.all([
        supabase.from("hand_players").select("*").eq("hand_id", hand.id).order("seat"),
        supabase.from("actions").select("*").eq("hand_id", hand.id).order("seq"),
        supabase.from("suggestions").select("*").eq("hand_id", hand.id).order("created_at", { ascending: false }),
      ]);
      return { hand, players: hp.data ?? [], actions: acts.data ?? [], suggestions: sug.data ?? [] };
    },
  });

  useEffect(() => {
    if (!isLocalBot() || !table || table.is_demo) return;
    bot.connectTable(tableId, true).catch((e) => toast.error(e instanceof Error ? e.message : "Could not open table"));
  }, [tableId, table?.is_demo]);

  useEffect(() => {
    if (!isLocalBot()) return;
    const ws = new WebSocket(bot.botSocketUrl());
    ws.onmessage = () => qc.invalidateQueries({ queryKey: ["live", tableId] });
    return () => ws.close();
  }, [tableId, qc]);

  const [selected, setSelected] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [ovAction, setOvAction] = useState<Action>("check");
  const [ovSize, setOvSize] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [events, setEvents] = useState<string[]>([]);

  const oppById = useMemo(() => new Map((opponents.data ?? []).map((o) => [o.id, o])), [opponents.data]);
  const hand = live.data?.hand;
  const raw = (hand?.raw ?? {}) as Raw;
  const pending = live.data?.suggestions.find((s) => s.accepted === "pending");
  const isAuto = table?.status === "autoplay";
  const selId = selected ?? live.data?.players[0]?.opponent_id ?? null;

  // listen to HUD events (from the extension later, from ourselves now)
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.source !== HUD_SOURCE) return;
      setEvents((prev) => [`${new Date().toLocaleTimeString()} ${e.data.type}`, ...prev].slice(0, 6));
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    if (!hand) return;
    emitHud({
      type: "table.state",
      game_id: table?.game_id ?? "",
      hand_number: hand.hand_number,
      street: (raw.street ?? "flop") as "flop",
      pot: Number(raw.pot ?? 0),
      board: hand.board,
      hero_cards: raw.hero_cards ?? [],
      seats: (live.data?.players ?? []).map((p) => ({ seat: p.seat, player_id: oppById.get(p.opponent_id)?.player_id ?? "", name: oppById.get(p.opponent_id)?.display_name ?? "", stack: Number(p.stack), in_hand: true })),
      to_act: pending ? "hero" : "",
    });
    if (pending) emitHud({ type: "table.suggestion", action: pending.suggested_action, size: pending.size, reason: pending.reason, confidence: Number(pending.confidence) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand?.id, hand?.board.length, pending?.id]);

  async function decide(kind: "taken" | "overridden" | "ignored", action?: Action, size?: number | null) {
    if (!pending || !hand || !table) return;
    setBusy(true);
    try {
      const actual = kind === "taken" ? (pending.suggested_action as Action) : kind === "overridden" ? action! : null;
      const actualSize = kind === "taken" ? pending.size : kind === "overridden" ? size ?? null : null;
      if (isLocalBot()) {
        await bot.postDecide(table.id, { kind, action: actual, size: actualSize, id: pending.id });
      } else {
        const { supabase } = await import("@/integrations/supabase/client");
        const { error } = await supabase.from("suggestions").update({ accepted: kind, actual_action: actual, actual_size: actualSize }).eq("id", pending.id);
        if (error) throw error;
      }
      emitHud({ type: "user.decision", decision: kind === "taken" ? "take" : kind === "overridden" ? "override" : "ignore", action: actual ?? undefined, size: actualSize });
      if (table.is_demo && !isLocalBot()) {
        const ayush = (opponents.data ?? []).find((o) => o.player_id === "pn_ayush")?.id;
        const river = (opponents.data ?? []).find((o) => o.player_id === "guest_riverboat")?.id;
        const inHand = new Set(live.data?.players.map((p) => p.opponent_id));
        await advanceDemo({
          tableId: table.id,
          hand: { id: hand.id, board: hand.board, raw: hand.raw as Raw },
          opp: { ayush: ayush && inHand.has(ayush) ? ayush : undefined, river: river && inHand.has(river) ? river : undefined },
          heroAction: actual ?? "check",
          heroSize: actual === "bet" || actual === "raise" || actual === "call" ? Number(actualSize ?? 0) : null,
        });
      }
      setOverrideOpen(false);
      qc.invalidateQueries();
      toast.success(kind === "taken" ? "Suggestion taken" : kind === "overridden" ? "Override recorded" : "Suggestion ignored");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  // auto-play countdown
  const [cancelledId, setCancelledId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<{ id: string; total: number; start: number } | null>(null);
  const [, tick] = useState(0);
  const decideRef = useRef(decide);
  decideRef.current = decide;
  useEffect(() => {
    if (!isAuto || !pending || cancelledId === pending.id || busy) {
      setCountdown(null);
      return;
    }
    const total = autoplayDelayMs();
    setCountdown({ id: pending.id, total, start: Date.now() });
    const iv = setInterval(() => tick((n) => n + 1), 50);
    const to = setTimeout(() => decideRef.current("taken"), total);
    return () => {
      clearInterval(iv);
      clearTimeout(to);
    };
  }, [isAuto, pending?.id, cancelledId, busy]);

  async function setStrategy(strategy: "theory" | "equity") {
    if (!settings.data) return;
    if (isLocalBot()) await bot.patchSettings({ strategy });
    else {
      const { supabase } = await import("@/integrations/supabase/client");
      await supabase.from("settings").update({ strategy }).eq("user_id", settings.data.user_id);
    }
    qc.invalidateQueries({ queryKey: ["settings"] });
  }

  async function dealNext() {
    if (!table || !hand || !live.data) return;
    setBusy(true);
    try {
      if (isLocalBot()) await bot.dealDemo(hand.hand_number + 1);
      else await dealNextDemoHand(table.id, hand.hand_number + 1, live.data.players.map((p) => ({ id: p.opponent_id, seat: p.seat, stack: Number(p.stack) })));
      qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not deal");
    } finally {
      setBusy(false);
    }
  }

  if (tables.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!table) return <p className="text-muted-foreground">Table not found. <Link to="/tables" className="text-gold underline">Back to tables</Link></p>;

  const connection = !table.is_demo && !settings.data?.extension_connected ? "Disconnected" : pending ? "Your action" : raw.live ? "Waiting for turn" : "Watching";
  const heroActs = (live.data?.actions ?? []).filter((a) => a.street === (raw.street ?? "flop"));

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="hud-panel flex flex-wrap items-center gap-3 p-2.5">
        <div className="mr-auto flex items-center gap-2">
          <span className="font-display text-lg font-semibold uppercase">{table.nickname ?? table.game_id}</span>
          <StatusPill status={table.status} />
        </div>
        <Segmented
          label="Mode"
          value={isAuto ? "auto" : "suggest"}
          options={[
            { v: "suggest", l: "Suggest" },
            { v: "auto", l: settings.data?.autoplay_confirmed_at ? "Auto-play" : "Auto-play 🔒" },
          ]}
          onChange={(v) => {
            if (v === "suggest") setStatus.mutate({ id: table.id, status: "suggesting" }, { onSuccess: () => emitHud({ type: "user.autoplay", enabled: false }) });
            else setAutoOpen(true);
          }}
          danger={isAuto}
        />
        <Segmented
          label="Strategy"
          value={settings.data?.strategy ?? "theory"}
          options={[
            { v: "theory", l: "Theory" },
            { v: "equity", l: "Equity" },
          ]}
          onChange={(v) => setStrategy(v as "theory" | "equity")}
        />
        <span className="flex items-center gap-1.5 rounded bg-muted px-2.5 py-1 text-xs">
          <span className={cn("size-2 rounded-full", connection === "Disconnected" ? "bg-destructive" : connection === "Your action" ? "bg-gold" : "bg-success")} />
          {connection}
        </span>
      </div>

      <AutoplayDialog
        open={autoOpen}
        onOpenChange={setAutoOpen}
        confirmed={!!settings.data?.autoplay_confirmed_at}
        onConfirm={() => {
          setStatus.mutate({ id: table.id, status: "autoplay" }, { onSuccess: () => emitHud({ type: "user.autoplay", enabled: true }) });
          setCancelledId(null);
          setAutoOpen(false);
        }}
      />

      {!hand ? (
        <div className="hud-panel p-10 text-center text-muted-foreground">
          Waiting for the extension to send <span className="font-mono">table.state</span> from this Poker Now table. Try the Demo table to click through a hand.
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[1fr_1.15fr_1fr]">
          {/* Center first on mobile */}
          <section className="hud-panel order-1 p-4 lg:order-2">
            <p className="hud-label">Suggested action · {raw.street ?? "flop"} · {settings.data?.strategy === "equity" ? "Equity" : "Theory"}</p>
            {pending ? (
              <>
                <p className="mt-3 font-display text-5xl font-bold uppercase leading-none text-gold md:text-6xl">
                  {formatSuggestion(pending.suggested_action, pending.size)}
                </p>
                <p className="mt-3 text-sm">{pending.reason}</p>
                <div className="mt-4">
                  <div className="h-2.5 overflow-hidden rounded bg-muted">
                    <div className="h-full bg-gold transition-all" style={{ width: `${pending.confidence}%` }} />
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">Confidence {Math.round(Number(pending.confidence))}%</p>
                </div>

                {countdown && (
                  <div className="mt-4 rounded border border-destructive bg-destructive/15 p-3">
                    <p className="text-sm font-semibold text-destructive">
                      Auto-play will act in {Math.max(0, (countdown.total - (Date.now() - countdown.start)) / 1000).toFixed(1)}s
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted">
                      <div className="h-full bg-destructive" style={{ width: `${Math.min(100, ((Date.now() - countdown.start) / countdown.total) * 100)}%` }} />
                    </div>
                    <Button variant="danger" size="sm" className="mt-2 w-full" onClick={() => setCancelledId(pending.id)}>
                      Cancel this action
                    </Button>
                  </div>
                )}

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <Button variant="take" className="h-12" disabled={busy} onClick={() => decide("taken")}>Take suggestion</Button>
                  <Button variant="outline" className="h-12" disabled={busy} onClick={() => setOverrideOpen((o) => !o)}>Override</Button>
                  <Button variant="ghost" className="h-12" disabled={busy} onClick={() => decide("ignored")}>Ignore</Button>
                </div>
                {overrideOpen && (
                  <div className="mt-3 space-y-2 rounded bg-muted p-3">
                    <div className="grid grid-cols-5 gap-1">
                      {ACTIONS.map((a) => (
                        <button
                          key={a}
                          onClick={() => setOvAction(a)}
                          className={cn("rounded py-2 font-display text-xs uppercase", ovAction === a ? "bg-gold text-gold-foreground" : "bg-secondary")}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                    {(ovAction === "bet" || ovAction === "raise" || ovAction === "call") && (
                      <Input type="number" placeholder="Size" value={ovSize} onChange={(e) => setOvSize(e.target.value)} />
                    )}
                    <Button className="w-full" disabled={busy} onClick={() => decide("overridden", ovAction, ovSize ? Number(ovSize) : null)}>
                      Confirm {ovAction}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="mt-4 space-y-3">
                <p className="text-muted-foreground">{raw.live === false ? "Hand complete." : "No action needed right now."}</p>
                {raw.live === false && (
                  <p className="font-mono text-sm">Hero result: <span className={Number(raw.hero_net) >= 0 ? "text-success" : "text-destructive"}>{Number(raw.hero_net) >= 0 ? "+" : ""}{raw.hero_net}</span></p>
                )}
                {table.is_demo && raw.live === false && (
                  <Button variant="take" disabled={busy} onClick={dealNext}>Deal next demo hand</Button>
                )}
              </div>
            )}
            <div className="mt-5 border-t pt-3">
              <p className="hud-label">Event log</p>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground">
                {events.length ? events.map((e, i) => <li key={i}>{e}</li>) : <li>No events yet</li>}
              </ul>
            </div>
          </section>

          {/* Left — table context */}
          <section className="hud-panel order-2 overflow-hidden lg:order-1">
            <div className="felt p-4">
              <div className="flex items-center justify-between">
                <p className="hud-label text-foreground/80">Hand #{hand.hand_number}</p>
                <p className="font-mono text-sm">Blinds {settings.data?.small_blind}/{settings.data?.big_blind}</p>
              </div>
              <div className="mt-4 flex justify-center gap-1.5">
                {[0, 1, 2, 3, 4].map((i) => <PlayingCard key={i} card={hand.board[i]} hidden={!hand.board[i]} />)}
              </div>
              <p className="mt-3 text-center font-display text-2xl font-semibold text-gold">Pot {raw.pot ?? 0}</p>
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <p className="hud-label text-foreground/80">Hero · {settings.data?.nickname}</p>
                  <p className="font-mono text-lg">{raw.hero_stack ?? "—"}</p>
                </div>
                <div className="flex gap-1">
                  {(raw.hero_cards ?? []).map((c) => <PlayingCard key={c} card={c} size="lg" />)}
                </div>
              </div>
            </div>
            <div className="divide-y">
              {(live.data?.players ?? []).map((p) => {
                const o = oppById.get(p.opponent_id);
                const s = stats.get(p.opponent_id);
                const folded = (live.data?.actions ?? []).some((a) => a.actor === p.opponent_id && a.action === "fold");
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelected(p.opponent_id)}
                    className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent", selId === p.opponent_id && "bg-accent", folded && "opacity-50")}
                  >
                    <span className="font-mono text-xs text-muted-foreground">S{p.seat}</span>
                    <span className="flex-1 font-semibold">{o?.display_name}{folded && <span className="ml-2 text-xs text-muted-foreground">folded</span>}</span>
                    <span className="font-mono text-xs">{p.stack}</span>
                    {s && <span className="font-mono text-[11px] text-muted-foreground">{pct(s.vpip)}/{pct(s.pfr)} · F {pct(s.foldToBet)}</span>}
                  </button>
                );
              })}
            </div>
            <div className="border-t p-4">
              <p className="hud-label">{raw.street ?? "flop"} action</p>
              <p className="mt-1 font-mono text-xs">
                {heroActs.length
                  ? heroActs.map((a) => `${a.actor === "hero" ? "Hero" : oppById.get(a.actor)?.display_name ?? "?"} ${a.action}${a.amount ? " " + a.amount : ""}`).join(" → ")
                  : "Hero to act"}
              </p>
            </div>
          </section>

          {/* Right — dossier */}
          <section className="order-3">
            {selId && <Dossier opponentId={selId} />}
          </section>
        </div>
      )}
    </div>
  );
}

function Segmented({ label, value, options, onChange, danger }: { label: string; value: string; options: { v: string; l: string }[]; onChange: (v: string) => void; danger?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="hud-label">{label}</span>
      <div className="flex rounded bg-muted p-0.5">
        {options.map((o) => (
          <button
            key={o.v}
            onClick={() => o.v !== value && onChange(o.v)}
            className={cn(
              "rounded px-2.5 py-1 font-display text-xs uppercase tracking-wider",
              value === o.v ? (danger && o.v === "auto" ? "bg-destructive text-destructive-foreground" : "bg-gold text-gold-foreground") : "text-muted-foreground",
            )}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

