/**
 * Event contract between the HUD (this app) and the future Chrome extension
 * injected into pokernow.club. Messages travel over window.postMessage with
 * `source: "table-coach"`.
 */
export type HudEvent =
  | {
      type: "table.state";
      game_id: string;
      hand_number: number;
      street: "preflop" | "flop" | "turn" | "river";
      pot: number;
      board: string[];
      hero_cards: string[];
      seats: { seat: number; player_id: string; name: string; stack: number; in_hand: boolean }[];
      to_act: "hero" | string;
    }
  | { type: "table.suggestion"; action: string; size: number | null; reason: string; confidence: number }
  | { type: "user.decision"; decision: "take" | "override" | "ignore"; action?: string | undefined; size?: number | null | undefined }
  | { type: "user.autoplay"; enabled: boolean };

export const HUD_SOURCE = "table-coach";

export function emitHud(event: HudEvent) {
  if (typeof window === "undefined") return;
  window.postMessage({ source: HUD_SOURCE, ...event }, window.location.origin);
}

export const CONTRACT_DOC = `// window.postMessage({ source: "table-coach", ...event })
type HudEvent =
  | { type: "table.state"; game_id; hand_number; street; pot;
      board: string[]; hero_cards: string[];
      seats: { seat; player_id; name; stack; in_hand }[];
      to_act: "hero" | player_id }
  | { type: "table.suggestion"; action; size | null; reason; confidence }
  | { type: "user.decision"; decision: "take" | "override" | "ignore"; action?; size? }
  | { type: "user.autoplay"; enabled: boolean }`;
