chrome.storage.session.get(["lastState", "lastAt", "lastPokerUrl"]).then((data) => {
  const el = document.getElementById("status");
  const fresh = data.lastAt && Date.now() - data.lastAt < 15000;
  if (fresh && data.lastState) {
    const s = data.lastState;
    el.className = "ok";
    el.textContent = `Live on ${s.game_id || "table"} · ${s.street || "hand"} · ${s.hero_turn ? "your action" : "watching"}`;
  } else {
    el.className = "wait";
    el.textContent = "Open a Poker Now private table in this browser.";
  }
});
