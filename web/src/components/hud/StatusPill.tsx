import { cn } from "@/lib/utils";

const STYLES: Record<string, string> = {
  idle: "bg-muted text-muted-foreground",
  watching: "bg-accent text-accent-foreground",
  suggesting: "bg-gold/20 text-gold",
  autoplay: "bg-destructive text-destructive-foreground",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 font-display text-xs uppercase tracking-wider", STYLES[status] ?? STYLES["idle"])}>
      {status === "autoplay" ? "Auto-play" : status}
    </span>
  );
}

export function LowSample({ hands }: { hands: number }) {
  return (
    <span className="rounded bg-warning/20 px-1.5 py-0.5 font-display text-[10px] uppercase tracking-wider text-warning">
      Low sample · {hands}
    </span>
  );
}
