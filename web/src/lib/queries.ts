import { queryOptions, useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import type { Database } from "@/integrations/supabase/types";
import { computeStats, type ActionRow, type OppStats } from "./poker";
import { isLocalBot } from "./local";
import * as bot from "./bot-api";
import type { BillingRow } from "./billing";

type Settings = Database["public"]["Tables"]["settings"]["Row"];
type Table = Database["public"]["Tables"]["tables"]["Row"];
type Opponent = Database["public"]["Tables"]["opponents"]["Row"];
type Hand = Database["public"]["Tables"]["hands"]["Row"];
type Suggestion = Database["public"]["Tables"]["suggestions"]["Row"];

async function sb() {
  const { supabase } = await import("@/integrations/supabase/client");
  return supabase;
}

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

export const billingQ = queryOptions({
  queryKey: ["billing"],
  queryFn: async () => {
    if (isLocalBot()) return { user_id: "local", plan: "lifetime", plan_status: "active", stripe_customer_id: null, stripe_subscription_id: null, plan_expires_at: null, updated_at: new Date().toISOString() } as BillingRow;
    const { data, error } = await (await sb()).from("billing").select("*").maybeSingle();
    if (error) return null;
    return data as BillingRow | null;
  },
});
export const settingsQ = queryOptions({
  queryKey: ["settings"],
  queryFn: async () => (isLocalBot() ? bot.getSettings() : must((await sb()).from("settings").select("*").maybeSingle())) as Settings,
});
export const tablesQ = queryOptions({
  queryKey: ["tables"],
  queryFn: async () => (isLocalBot() ? bot.getTables() : must((await sb()).from("tables").select("*").order("created_at", { ascending: false }))) as Table[],
});
export const opponentsQ = queryOptions({
  queryKey: ["opponents"],
  queryFn: async () => (isLocalBot() ? bot.getOpponents() : must((await sb()).from("opponents").select("*").order("last_seen", { ascending: false }))) as Opponent[],
});
export const handsQ = queryOptions({
  queryKey: ["hands"],
  queryFn: async () => (isLocalBot() ? bot.getHands() : must((await sb()).from("hands").select("*").order("started_at", { ascending: false }))) as Hand[],
});
export const suggestionsQ = queryOptions({
  queryKey: ["suggestions"],
  queryFn: async () => (isLocalBot() ? bot.getSuggestions() : must((await sb()).from("suggestions").select("*").order("created_at", { ascending: false }))) as Suggestion[],
});

export const bookQ = queryOptions({
  queryKey: ["book"],
  queryFn: async () => {
    if (isLocalBot()) return bot.getBook() as Promise<{ hp: { hand_id: string; opponent_id: string; seat: number; stack: number; won: number }[]; actions: ActionRow[]; sd: { hand_id: string; opponent_id: string; cards: string[] }[] }>;
    const supabase = await sb();
    const [hp, actions, sd] = await Promise.all([
      must(supabase.from("hand_players").select("hand_id, opponent_id, seat, stack, won")).then((d) => d ?? []),
      must(supabase.from("actions").select("hand_id, seq, actor, street, action, amount, facing").limit(5000)).then((d) => d ?? []),
      must(supabase.from("showdowns").select("hand_id, opponent_id, cards")).then((d) => d ?? []),
    ]);
    return { hp, actions: actions as ActionRow[], sd };
  },
});

export function useStats() {
  const book = useQuery(bookQ);
  const stats = new Map<string, OppStats>();
  if (book.data) {
    const { hp, actions, sd } = book.data;
    const ids = new Set(hp.map((r) => r.opponent_id));
    for (const id of ids) {
      const rows = hp.filter((r) => r.opponent_id === id);
      const handIds = rows.map((r) => r.hand_id);
      const hs = new Set(handIds);
      const shows = new Set(sd.filter((s) => s.opponent_id === id).map((s) => s.hand_id));
      const chips = rows.reduce((a, r) => a + Number(r.won), 0);
      stats.set(id, computeStats(id, handIds, actions.filter((a) => hs.has(a.hand_id)), shows, chips));
    }
  }
  return { stats, book: book.data, isLoading: book.isLoading };
}

export function useSetTableStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "idle" | "watching" | "suggesting" | "autoplay" }) => {
      if (isLocalBot()) {
        await bot.patchTable(id, { status });
        return;
      }
      const supabase = await sb();
      await must(supabase.from("tables").update({ status, last_seen_at: new Date().toISOString() }).eq("id", id).select());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}
