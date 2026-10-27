export type Action = "fold" | "check" | "call" | "bet" | "raise";
export const ACTIONS: Action[] = ["fold", "check", "call", "bet", "raise"];
export type Street = "preflop" | "flop" | "turn" | "river";

export interface ActionRow {
  hand_id: string;
  seq: number;
  actor: string;
  street: string;
  action: string;
  amount: number | null;
  facing: string;
}

export interface OppStats {
  hands: number;
  vpip: number;
  pfr: number;
  threeBet: number;
  af: number;
  foldToBet: number;
  cbet: number;
  wtsd: number;
  chips: number;
  lowSample: boolean;
}

/** Population priors used for shrinkage (fractions, AF as ratio). */
export const PRIORS = {
  vpip: 0.28,
  pfr: 0.18,
  threeBet: 0.07,
  af: 2.0,
  foldToBet: 0.45,
  cbet: 0.6,
  wtsd: 0.28,
};
export const PRIOR_WEIGHT = 20;
export const LOW_SAMPLE = 20;

/** Bayesian-style shrink: blend observed rate toward prior with weight PRIOR_WEIGHT. */
export function shrink(successes: number, trials: number, prior: number, weight = PRIOR_WEIGHT) {
  return (successes + prior * weight) / (trials + weight);
}

/**
 * Compute stats for one opponent from that user's own rows.
 * handIds = hands the opponent was dealt into; showdownHandIds = hands they showed.
 */
export function computeStats(
  opponentId: string,
  handIds: string[],
  actions: ActionRow[],
  showdownHandIds: Set<string>,
  chips: number,
): OppStats {
  const byHand = new Map<string, ActionRow[]>();
  for (const a of actions) {
    if (!byHand.has(a.hand_id)) byHand.set(a.hand_id, []);
    byHand.get(a.hand_id)!.push(a);
  }
  let vpip = 0, pfr = 0, threeOpp = 0, three = 0, aggr = 0, calls = 0;
  let facedBet = 0, foldedBet = 0, cbetOpp = 0, cbet = 0, sawFlop = 0, wtsd = 0;
  for (const hid of handIds) {
    const rows = (byHand.get(hid) ?? []).slice().sort((a, b) => a.seq - b.seq);
    const mine = rows.filter((r) => r.actor === opponentId);
    const pre = mine.filter((r) => r.street === "preflop");
    if (pre.some((r) => r.action === "call" || r.action === "raise" || r.action === "bet")) vpip++;
    const raisedPre = pre.some((r) => r.action === "raise");
    if (raisedPre) pfr++;
    const facingRaisePre = pre.filter((r) => r.facing === "raise");
    if (facingRaisePre.length) {
      threeOpp++;
      if (facingRaisePre.some((r) => r.action === "raise")) three++;
    }
    const post = mine.filter((r) => r.street !== "preflop");
    for (const r of post) {
      if (r.action === "bet" || r.action === "raise") aggr++;
      if (r.action === "call") calls++;
      if (r.facing === "bet" || r.facing === "raise") {
        facedBet++;
        if (r.action === "fold") foldedBet++;
      }
    }
    if (post.length) sawFlop++;
    // c-bet: last preflop raiser leads the flop
    const lastPreRaise = rows.filter((r) => r.street === "preflop" && r.action === "raise").at(-1);
    if (lastPreRaise?.actor === opponentId) {
      const flopFirst = mine.find((r) => r.street === "flop" && r.facing === "none");
      if (flopFirst) {
        cbetOpp++;
        if (flopFirst.action === "bet") cbet++;
      }
    }
    if (showdownHandIds.has(hid)) wtsd++;
  }
  const n = handIds.length;
  return {
    hands: n,
    vpip: shrink(vpip, n, PRIORS.vpip),
    pfr: shrink(pfr, n, PRIORS.pfr),
    threeBet: shrink(three, threeOpp, PRIORS.threeBet),
    af: (aggr + PRIORS.af * 5) / (calls + 5),
    foldToBet: shrink(foldedBet, facedBet, PRIORS.foldToBet),
    cbet: shrink(cbet, cbetOpp, PRIORS.cbet),
    wtsd: shrink(wtsd, sawFlop, PRIORS.wtsd),
    chips,
    lowSample: n < LOW_SAMPLE,
  };
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export function formatSuggestion(action: string, size: number | null | undefined) {
  const a = action.toUpperCase();
  if (action === "raise" && size) return `RAISE to ${size}`;
  if ((action === "bet" || action === "call") && size) return `${a} ${size}`;
  return a;
}

/** Product rule: auto-play is available only with all four consent items confirmed. */
export const CONSENT_ITEMS = [
  "This is a private table.",
  "Every seated player has been told a bot/assistant may act.",
  "The host allows automation.",
  "I understand auto-play is optional and I am responsible for using it.",
] as const;

export function canEnableAutoplay(checks: boolean[]) {
  return checks.length === CONSENT_ITEMS.length && checks.every(Boolean);
}

/** Auto-play countdown is between 1.0s and 1.6s. */
export function autoplayDelayMs(rand = Math.random()) {
  return Math.round(1000 + Math.min(Math.max(rand, 0), 1) * 600);
}

export function parseCard(c: string) {
  const rank = c.slice(0, -1).replace("T", "10");
  const s = c.slice(-1);
  const suit = ({ h: "♥", d: "♦", s: "♠", c: "♣" } as Record<string, string>)[s] ?? s;
  return { rank, suit, red: s === "h" || s === "d" };
}

export function parsePokerNowUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (!/(^|\.)pokernow\.(club|com)$/.test(u.hostname)) return null;
    const m = u.pathname.match(/\/games\/([A-Za-z0-9_-]+)/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}
