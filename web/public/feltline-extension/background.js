const HUD = [
  "https://feltline-ten.vercel.app",
  "http://localhost:8080",
  "http://localhost:8081",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:8081",
];
const PN = ["https://www.pokernow.com/games/", "https://www.pokernow.club/games/"];

async function tabsMatching(prefixes) {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((t) => t.id && t.url && prefixes.some((p) => t.url.startsWith(p)));
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.source !== "table-coach") return;
  if (msg.type === "table.state" || msg.from === "extension") {
    const url = sender.tab?.url || "";
    chrome.storage.session.set({ lastState: msg, lastPokerUrl: url, lastAt: Date.now() });
    tabsMatching(HUD).then((tabs) => {
      for (const tab of tabs) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
    });
  }
  if (msg.type === "user.decision" || msg.type === "user.autoplay" || msg.type === "ping") {
    tabsMatching(PN).then((tabs) => {
      for (const tab of tabs) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
    });
  }
});
