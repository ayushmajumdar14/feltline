/** Local bot mode when the Python HUD API is serving this workspace. */
export function isLocalBot() {
  if (import.meta.env.VITE_LOCAL_BOT === "0") return false;
  if (import.meta.env.VITE_BOT_URL) return true;
  return !import.meta.env.VITE_SUPABASE_URL;
}

export const BOT_URL = (import.meta.env.VITE_BOT_URL as string | undefined) || "";
