import { supabase } from "@/integrations/supabase/client";

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in first.");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export async function startCheckout(plan: "monthly" | "yearly" | "lifetime") {
  const res = await fetch("/api/stripe/checkout", { method: "POST", headers: await authHeader(), body: JSON.stringify({ plan }) });
  const body = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error || "Could not start checkout");
  window.location.href = body.url;
}

export async function openBillingPortal() {
  const res = await fetch("/api/stripe/portal", { method: "POST", headers: await authHeader() });
  const body = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error || "Could not open the billing portal");
  window.location.href = body.url;
}

export async function confirmCheckout(sessionId: string) {
  const res = await fetch("/api/stripe/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId }) });
  const body = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok) throw new Error(body.error || "Could not confirm payment");
}
