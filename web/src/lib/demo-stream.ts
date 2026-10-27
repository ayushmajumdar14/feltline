import type { Action } from "./poker";

async function sb() {
  return (await import("@/integrations/supabase/client")).supabase;
}

export interface DemoStreet {
  street: "flop" | "turn" | "river";
  card?: string;
  suggestion: { action: Action; pctPot: number | null; reason: string; confidence: number };
}

export const DEMO_SCRIPT: DemoStreet[] = [
  {
    street: "flop",
    suggestion: {
      action: "bet",
      pctPot: 0.66,
      reason: "Range c-bet, dry board. Bet 66% pot — Ayush calls wide, riverboat folds this texture often.",
      confidence: 71,
    },
  },
  {
    street: "turn",
    card: "5s",
    suggestion: {
      action: "bet",
      pctPot: 0.6,
      reason: "Blank turn. Ayush rarely folds to bets, so keep betting for value with top pair.",
      confidence: 64,
    },
  },
  {
    street: "river",
    card: "9d",
    suggestion: {
      action: "bet",
      pctPot: 0.5,
      reason: "Thin value on a quiet river; Ayush calls down with weaker kings and sevens.",
      confidence: 58,
    },
  },
];

const NEXT_FLOPS = [
  { board: ["Qs", "8d", "3c"], hero: ["As", "Qd"] },
  { board: ["Jh", "6c", "2s"], hero: ["Ac", "Jc"] },
  { board: ["Kc", "9s", "4d"], hero: ["Kh", "Ts"] },
];

type Raw = { hero_cards?: string[]; pot?: number; live?: boolean; street?: string; hero_stack?: number; hero_net?: number; flop_idx?: number };

export function sizeFor(pctPot: number | null, pot: number) {
  return pctPot ? Math.max(2, Math.round(pot * pctPot)) : null;
}

/** Advance the fake hand after the hero acts. Opponent responses follow their seeded tendencies. */
export async function advanceDemo(opts: {
  tableId: string;
  hand: { id: string; board: string[]; raw: Raw };
  opp: { ayush?: string | undefined; river?: string | undefined };
  heroAction: Action;
  heroSize: number | null;
}) {
  const { hand, heroAction, heroSize, opp } = opts;
  const raw = hand.raw;
  const street = (raw.street ?? "flop") as DemoStreet["street"];
  const idx = DEMO_SCRIPT.findIndex((s) => s.street === street);
  let pot = Number(raw.pot ?? 0);
  let heroStack = Number(raw.hero_stack ?? 200);

  const supabase = await sb();
  const { data: last } = await supabase.from("actions").select("seq").eq("hand_id", hand.id).order("seq", { ascending: false }).limit(1);
  let seq = last?.[0]?.seq ?? 0;
  const rows: { hand_id: string; seq: number; actor: string; street: string; action: string; amount: number | null; facing: string }[] = [];
  const push = (actor: string, action: string, amount: number | null, facing: string) =>
    rows.push({ hand_id: hand.id, seq: ++seq, actor, street, action, amount, facing });

  push("hero", heroAction, heroSize, "none");
  const aggressive = heroAction === "bet" || heroAction === "raise";
  if (aggressive && heroSize) {
    pot += heroSize;
    heroStack -= heroSize;
  }
  const riverboatIn = street === "flop" ? true : (raw as { river_in?: boolean }).river_in ?? false;
  let stillRiver = riverboatIn;
  if (opp.ayush) {
    if (aggressive) {
      push(opp.ayush, "call", heroSize, "bet");
      pot += heroSize ?? 0;
    } else push(opp.ayush, "check", null, "none");
  }
  if (opp.river && riverboatIn) {
    if (aggressive) {
      push(opp.river, "fold", null, "bet");
      stillRiver = false;
    } else {
      push(opp.river, "check", null, "none");
    }
  }
  if (heroAction === "fold") {
    await supabase.from("actions").insert(rows);
    await supabase.from("hands").update({ raw: { ...raw, live: false, pot, hero_stack: heroStack, hero_net: -(200 - heroStack) } }).eq("id", hand.id);
    return { done: true };
  }
  await supabase.from("actions").insert(rows);

  const next = DEMO_SCRIPT[idx + 1];
  if (!next) {
    // showdown: Ayush shows a weaker king
    if (opts.opp.ayush) await supabase.from("showdowns").insert({ hand_id: hand.id, opponent_id: opts.opp.ayush, cards: ["Kh", "8h"] });
    await supabase.from("hands").update({ raw: { ...raw, live: false, pot, hero_stack: heroStack + pot, hero_net: pot - (200 - heroStack) } }).eq("id", hand.id);
    return { done: true };
  }
  const board = next.card ? [...hand.board, next.card] : hand.board;
  await supabase
    .from("hands")
    .update({ board, raw: { ...raw, street: next.street, pot, hero_stack: heroStack, river_in: stillRiver } })
    .eq("id", hand.id);
  await supabase.from("suggestions").insert({
    table_id: opts.tableId,
    hand_id: hand.id,
    street: next.street,
    suggested_action: next.suggestion.action,
    size: sizeFor(next.suggestion.pctPot, pot),
    reason: next.suggestion.reason,
    confidence: next.suggestion.confidence,
  });
  return { done: false };
}

export async function dealNextDemoHand(tableId: string, handNumber: number, opp: { id: string; seat: number; stack: number }[]) {
  const f = NEXT_FLOPS[handNumber % NEXT_FLOPS.length]!;
  const pot = 20;
  const supabase = await sb();
  const { data: hand, error } = await supabase
    .from("hands")
    .insert({ table_id: tableId, hand_number: handNumber, board: f.board, raw: { hero_cards: f.hero, pot, live: true, street: "flop", hero_stack: 194, river_in: true } })
    .select()
    .single();
  if (error || !hand) throw new Error(error?.message ?? "Could not deal");
  await supabase.from("hand_players").insert(opp.map((o) => ({ hand_id: hand.id, opponent_id: o.id, seat: o.seat, stack: o.stack, won: 0 })));
  const ids = opp.map((o) => o.id);
  const preRows = [
    { hand_id: hand.id, seq: 1, actor: "hero", street: "preflop", action: "raise", amount: 6, facing: "blind" },
    ...ids.map((id, i) => ({ hand_id: hand.id, seq: i + 2, actor: id, street: "preflop", action: i === 1 ? "fold" : "call", amount: i === 1 ? null : 6, facing: "raise" })),
  ];
  await supabase.from("actions").insert(preRows);
  const s = DEMO_SCRIPT[0]!.suggestion;
  await supabase.from("suggestions").insert({
    table_id: tableId,
    hand_id: hand.id,
    street: "flop",
    suggested_action: s.action,
    size: sizeFor(s.pctPot, pot),
    reason: s.reason,
    confidence: s.confidence,
  });
}
