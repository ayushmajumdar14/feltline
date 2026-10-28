/* Port of poker_agent.pokernow_state.TableTracker for the extension. */
const DELETE = "<D>";
const STREETS = { 0: "preflop", 3: "flop", 4: "turn", 5: "river" };

function applyDiff(state, diff) {
  for (const [key, value] of Object.entries(diff || {})) {
    if (value === DELETE) delete state[key];
    else if (value && typeof value === "object" && !Array.isArray(value) && state[key] && typeof state[key] === "object" && !Array.isArray(state[key])) {
      applyDiff(state[key], value);
    } else state[key] = value;
  }
  return state;
}

function parseFrame(frame) {
  if (typeof frame !== "string") return null;
  for (const part of frame.split("\x1e")) {
    if (!part.startsWith("42")) continue;
    let i = 2;
    if (part[i] === "/") {
      const comma = part.indexOf(",", i);
      if (comma < 0) continue;
      i = comma + 1;
    }
    try {
      const msg = JSON.parse(part.slice(i));
      if (Array.isArray(msg) && msg.length) return { event: msg[0], payload: msg[1] };
    } catch {
      /* ignore malformed engine.io */
    }
  }
  return null;
}

function chips(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normCard(card) {
  if (!card || typeof card !== "string") return null;
  let c = card.trim();
  if (c.length === 3 && c.startsWith("10")) c = "T" + c[2];
  if (c.length !== 2) return null;
  const rank = c[0].toUpperCase();
  const suit = c[1].toLowerCase();
  if (!"23456789TJQKA".includes(rank) || !"cdhs".includes(suit)) return null;
  return rank + suit;
}

function gameIdFromUrl(href) {
  try {
    const m = new URL(href).pathname.match(/\/games\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

class TableTracker {
  constructor() {
    this.me = null;
    this.raw = {};
    this.history = [];
  }

  highestBet() {
    return Math.max(chips(this.raw.cHB), ...Object.values(this.raw.tB || {}).map(chips));
  }

  board() {
    const runs = this.raw.oTC || {};
    return [...(runs["1"] || [])].map(normCard).filter(Boolean);
  }

  feed(frame) {
    const parsed = parseFrame(frame);
    if (!parsed) return null;
    const { event, payload } = parsed;
    if (event === "registered" && payload && typeof payload === "object") {
      this.me = payload.currentPlayer?.id || null;
      this.raw = payload.gameState || {};
      this.history = [];
    } else if (event === "gC" && payload && typeof payload === "object") {
      const handBefore = this.raw.hI;
      const highestBefore = this.highestBet();
      const betsBefore = { ...(this.raw.tB || {}) };
      applyDiff(this.raw, payload);
      if (this.raw.hI !== handBefore) this.history = [];
      else if (!("oTC" in payload)) this.recordActions(payload, betsBefore, highestBefore);
    }
    this.inferMe();
    return event;
  }

  inferMe() {
    if (this.me) return this.me;
    const hole = this.raw.pC || {};
    for (const [pid, info] of Object.entries(hole)) {
      const cards = info?.cards || [];
      if (cards.some((c) => c && (c.value || typeof c === "string"))) {
        this.me = pid;
        return pid;
      }
    }
    return this.me;
  }

  recordActions(payload, betsBefore, highestBefore) {
    const street = STREETS[this.board().length] || "preflop";
    const bb = chips(this.raw.bigBlind);
    for (const [pid, status] of Object.entries(payload.pGS || {})) {
      if (status === "fold") this.history.push([pid, street, "fold", null]);
    }
    for (const [pid, bet] of Object.entries(payload.tB || {})) {
      if (bet === DELETE) continue;
      if (typeof bet === "string") {
        if (bet.toLowerCase().includes("check")) this.history.push([pid, street, "check", null]);
        continue;
      }
      const amount = chips(bet);
      if (amount <= chips(betsBefore[pid])) continue;
      const floor = street === "preflop" ? bb : 0;
      const kind = amount > Math.max(highestBefore, floor) ? (street !== "preflop" && highestBefore === 0 ? "bet" : "raise") : "call";
      this.history.push([pid, street, kind, amount]);
    }
  }

  get heroTurn() {
    return Boolean(this.me) && this.raw.cPI === this.me && this.raw.sNA === "FCPFS";
  }

  snapshot() {
    const raw = this.raw;
    const me = this.me;
    const players = raw.players || {};
    const bets = raw.tB || {};
    const statuses = raw.pGS || {};
    const seats = raw.seats || [];
    const hero = players[me] || {};
    const heroCards = ((raw.pC || {})[me]?.cards || []).map((c) => normCard(c?.value)).filter(Boolean);
    const board = this.board();
    const myBet = chips(bets[me]);
    const highest = Math.max(chips(raw.cHB), ...Object.values(bets).map(chips));
    const streetBets = Object.values(bets).reduce((a, v) => a + chips(v), 0);
    const stack = chips(hero.stack);
    const street = STREETS[board.length] || "preflop";
    const seatOf = (pid) => {
      const hit = seats.find((s) => s[1] === pid);
      return hit ? hit[0] : 0;
    };
    const inHand = (pid) => statuses[pid] !== "fold";
    return {
      type: "table.state",
      game_id: gameIdFromUrl(location.href),
      hand_number: raw.gN || 0,
      street,
      pot: chips(raw.pot) + streetBets,
      board,
      hero_cards: heroCards,
      hero_id: me || "",
      hero_seat: seatOf(me),
      hero_stack: stack,
      hero_bet: myBet,
      dealer_seat: raw.dealerSeat ?? null,
      amount_to_call: Math.min(Math.max(highest - myBet, 0), stack),
      min_raise_to: chips(raw.mR) || null,
      big_blind: chips(raw.bigBlind) || 2,
      hero_turn: this.heroTurn,
      to_act: this.heroTurn ? "hero" : raw.cPI || "",
      history: this.history.slice(-48),
      seats: Object.keys(players).map((pid) => ({
        seat: seatOf(pid),
        player_id: pid,
        name: players[pid]?.name || pid,
        stack: chips(players[pid]?.stack),
        in_hand: pid === me ? true : inHand(pid),
      })),
    };
  }
}
