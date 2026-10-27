<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- All poker data rows carry `user_id` with RLS `user_id = auth.uid()`; a signup trigger seeds each workspace's demo table via `seed_demo_workspace` — keeps workspaces isolated.
- Opponent stats are computed client-side from the user's own rows in `src/lib/poker.ts` (shrunk toward priors) — no shared opponent book.
- Extension contract lives in `src/lib/hud-events.ts` (window.postMessage, source "table-coach") — single source for the HUD ↔ extension shape.
