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

## Limits
Preflop uses charts. Flops and turns use range equity plus frequency rules. Only heads-up rivers are solved. Multiway pots fall back to range equity. It is an approximation of sound theory, not GTO.
