export type PlanId = "free" | "monthly" | "yearly" | "lifetime";
export type PlanStatus = "none" | "active" | "canceled" | "past_due";

export type BillingRow = {
  user_id: string;
  plan: PlanId;
  plan_status: PlanStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan_expires_at: string | null;
  updated_at: string;
};

export const PLANS = [
  { id: "monthly" as const, name: "Monthly", price: "$3", detail: "billed every month", cents: 300, interval: "month" as const },
  { id: "yearly" as const, name: "Yearly", price: "$25", detail: "one year, about $2.08/mo", cents: 2500, interval: "year" as const },
  { id: "lifetime" as const, name: "Lifetime", price: "$50", detail: "pay once, keep the coach", cents: 5000, interval: null },
];

/** Live-table paywall. Off until VITE_BILLING=1 so a deploy cannot lock the site before Stripe is ready. */
export function paywallOn() {
  return import.meta.env["VITE_BILLING"] === "1";
}

export function hasPaidAccess(row: BillingRow | null | undefined): boolean {
  if (!row) return false;
  if (row.plan === "lifetime" && row.plan_status === "active") return true;
  if ((row.plan === "monthly" || row.plan === "yearly") && row.plan_status === "active") return true;
  if (row.plan_status === "canceled" && row.plan_expires_at && new Date(row.plan_expires_at).getTime() > Date.now()) return true;
  return false;
}

export function canUseLiveTables(row: BillingRow | null | undefined): boolean {
  if (!paywallOn()) return true;
  return hasPaidAccess(row);
}

export function planLabel(row: BillingRow | null | undefined): string {
  if (!row || row.plan === "free") return "Free · demo table only";
  if (row.plan === "lifetime" && row.plan_status === "active") return "Lifetime";
  if (row.plan_status === "active") return row.plan === "yearly" ? "Yearly" : "Monthly";
  if (row.plan_status === "canceled" && hasPaidAccess(row)) return `${row.plan} · ends ${new Date(row.plan_expires_at!).toLocaleDateString()}`;
  if (row.plan_status === "past_due") return "Past due";
  return "Free · demo table only";
}
