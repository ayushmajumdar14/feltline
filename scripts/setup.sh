#!/bin/sh
set -e
cd "$(dirname "$0")/.."
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
python -m playwright install chromium
[ -f config.json ] || cp config.example.json config.json
echo "Edit config.json (table_url, buy_in, private_bot_game_confirmed), then:"
echo "  .venv/bin/poker-agent --config config.json serve"
echo "  cd web && npm install && npm run dev"
