import { cn } from "@/lib/utils";
import { parseCard } from "@/lib/poker";

export function PlayingCard({ card, size = "md", hidden }: { card?: string | undefined; size?: "sm" | "md" | "lg"; hidden?: boolean }) {
  const dims = size === "sm" ? "h-9 w-7 text-xs" : size === "lg" ? "h-20 w-14 text-xl" : "h-14 w-10 text-base";
  if (!card || hidden) {
    return <div className={cn(dims, "rounded border border-gold/40 bg-felt-deep")} aria-label="Hidden card" />;
  }
  const { rank, suit, red } = parseCard(card);
  return (
    <div
      className={cn(
        dims,
        "flex flex-col items-center justify-center rounded bg-card-face font-mono font-semibold leading-none shadow",
        red ? "text-pip-red" : "text-pip-black",
      )}
      aria-label={card}
    >
      <span>{rank}</span>
      <span>{suit}</span>
    </div>
  );
}
