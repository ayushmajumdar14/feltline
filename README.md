# Feltline

A suggested-action coach for **private Poker Now tables** where everyone at the table has agreed an assistant may play. Each person who runs it gets their own opponent book. It is not a casino, not a stealth bot, and not a full GTO solver.

Default mode is **Suggested action**: you confirm Fold / Check / Call / Bet / Raise. **Auto-play** is off until you complete a consent checklist, then it can click for you on that private table.

## What you get
- Feltline HUD (`web/`): tables, live coach, opponents, hands, settings
- Local bot (`poker-agent serve`): reads the Poker Now socket, ranks the spot, and either waits for your click or acts
- Per-user SQLite memory: VPIP, PFR, fold-to-bet, shown hands, suggestions you took or overrode
- After a bust it requests the same buy-in again (the host still has to approve the seat)

## Run your own copy

You need Python 3.11+, Node, and a Poker Now private-table link.

```bash
git clone https://github.com/ayushmajumdar14/feltline.git
cd feltline
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e '.[test]'
python -m playwright install chromium
cp config.example.json config.json
```

Edit `config.json`:

1. Paste your table URL into `table_url`
2. Set `bot_nickname` and `buy_in`
3. Set `private_bot_game_confirmed` to `true` only after every seated player has agreed

Then start both sides:

```bash
poker-agent --config config.json serve --port 8765
# other terminal
cd web && npm install && npm run dev
```

Open the Vite URL (usually http://localhost:8080). Sign-in is skipped in local mode. Try the **Demo table** first. Opening your real table starts a Chromium window — do not click inside it. Take / Override / Ignore drive the bot. Auto-play is in Settings, then on the table.

Without the HUD:

```bash
poker-agent --config config.json play --mode play --sit
```

## Rules of the road
- Private tables only. Suggested-action wording does not make auto-play legal on rooms that forbid bots.
- Each clone has its own `players.sqlite3` and `.bot-profile`. Do not share those files if you want isolated memory.
- The host must approve the seat the first time and after every bust, unless the table auto-approves.

## More commands
```bash
poker-agent --config config.json import-log
poker-agent --config config.json players
poker-agent --config config.json player-stats helo
poker-agent simulate theory equity --deals 3000 --seed 11
```

## Public website (Vercel + Supabase)

Public HUD: [https://feltline-ten.vercel.app](https://feltline-ten.vercel.app). Each visitor signs up; Supabase keeps their profile, tables, opponents and hands behind row-level security.

**Add table** on the website saves the Poker Now link. Live play uses the **Chrome extension** (`extension/` in this repo) — no terminal for other people:

1. Chrome → `chrome://extensions` → Developer mode → Load unpacked → `extension/`
2. Sign in on the site and add the table link
3. Open that Poker Now game in the same Chrome profile
4. Take / Override / Ignore on the Feltline coach tab; the extension clicks on Poker Now

The Demo table works with no extension. Auto-play still needs the Settings consent checklist. Private tables only.

On [Vercel](https://vercel.com/new) import `ayushmajumdar14/feltline`, set **Root Directory** to `web`, and add:

```
VITE_LOCAL_BOT=0
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
SITE_URL=https://feltline-ten.vercel.app
VITE_BILLING=1
```

Paid live tables ($3/month, $25/year, $50 lifetime) use Stripe Checkout. Run `web/drizzle/migrations/0002_billing.sql` in the Supabase SQL editor, then add a Stripe webhook to `https://feltline-ten.vercel.app/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_failed`. The demo table stays free.

In the Supabase project, add the Vercel URL to Auth → Redirect URLs and to allowed origins. Signup already creates a `profiles` row, default settings, and a demo table (`handle_new_user` in `web/drizzle/migrations`).

## Limits
Preflop uses charts. Flops and turns use range equity plus frequency rules. Only heads-up rivers are solved. Multiway pots fall back to range equity. It is an approximation of sound theory, not GTO.
