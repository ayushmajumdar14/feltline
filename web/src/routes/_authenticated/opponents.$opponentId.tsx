import { createFileRoute, Link } from "@tanstack/react-router";
import { Dossier } from "@/components/hud/Dossier";

export const Route = createFileRoute("/_authenticated/opponents/$opponentId")({
  head: () => ({
    meta: [
      { title: "Opponent dossier — Feltline" },
      { name: "description", content: "Stats, shown hands and notes for one opponent." },
      { property: "og:title", content: "Opponent dossier — Feltline" },
      { property: "og:description", content: "Opponent stats and notes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OpponentPage,
});

function OpponentPage() {
  const { opponentId } = Route.useParams();
  return (
    <div className="mx-auto max-w-xl space-y-3">
      <Link to="/opponents" className="text-sm text-gold hover:underline">← All opponents</Link>
      <Dossier opponentId={opponentId} />
      <Link to="/hands" search={{ opponent: opponentId }} className="block text-sm text-gold hover:underline">See hands with this player →</Link>
    </div>
  );
}
