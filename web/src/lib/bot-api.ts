import { BOT_URL } from "./local";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BOT_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.error || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const getSettings = () => req<Record<string, unknown>>("/api/settings");
export const patchSettings = (patch: Record<string, unknown>) =>
  req("/api/settings", { method: "PATCH", body: JSON.stringify(patch) });
export const getProfile = () => req<Record<string, unknown>>("/api/profile");
export const patchProfile = (patch: Record<string, unknown>) =>
  req("/api/profile", { method: "PATCH", body: JSON.stringify(patch) });
export const getTables = () => req<Record<string, unknown>[]>("/api/tables");
export const postTable = (body: Record<string, unknown>) =>
  req("/api/tables", { method: "POST", body: JSON.stringify(body) });
export const patchTable = (id: string, body: Record<string, unknown>) =>
  req(`/api/tables/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const getOpponents = () => req<Record<string, unknown>[]>("/api/opponents");
export const patchOpponent = (id: string, notes: string) =>
  req(`/api/opponents/${id}`, { method: "PATCH", body: JSON.stringify({ notes }) });
export const getHands = () => req<Record<string, unknown>[]>("/api/hands");
export const getHand = (id: string) => req<Record<string, unknown>>(`/api/hands/${id}`);
export const getSuggestions = () => req<Record<string, unknown>[]>("/api/suggestions");
export const getBook = () => req<{ hp: unknown[]; actions: unknown[]; sd: unknown[] }>("/api/book");
export const getShowdowns = (id: string) => req<unknown[]>(`/api/showdowns/${id}`);
export const getLive = (id: string) => req<Record<string, unknown> | null>(`/api/live/${id}`);
export const postDecide = (id: string, body: Record<string, unknown>) =>
  req(`/api/live/${id}/decide`, { method: "POST", body: JSON.stringify(body) });
export const connectTable = (id: string, sit = true) =>
  req(`/api/tables/${id}/connect`, { method: "POST", body: JSON.stringify({ sit }) });
export const stopTable = (id: string) => req(`/api/tables/${id}/stop`, { method: "POST" });
export const dealDemo = (hand_number: number) =>
  req("/api/demo/deal", { method: "POST", body: JSON.stringify({ hand_number }) });
export const resetDemo = () => req("/api/demo/reset", { method: "POST" });
export const exportAll = () => req<Record<string, unknown>>("/api/export");

export function botSocketUrl() {
  if (BOT_URL) {
    const u = new URL(BOT_URL);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/ws";
    return u.toString();
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.hostname}:8765/ws`;
}
