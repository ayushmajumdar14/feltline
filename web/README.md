# Feltline HUD

Control panel for the local poker agent. In this repo it talks to `poker-agent serve` (not Supabase).

```bash
# from the repo root
poker-agent --config config.json serve --port 8765
cd web && npm install && npm run dev
```

Open the Vite URL. Suggested action is the default. Auto-play stays locked until the Settings checklist is complete.

Set `VITE_LOCAL_BOT=0` and add Supabase keys only if you are running the Lovable cloud app instead of the local bot.
