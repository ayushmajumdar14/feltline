function isHudUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.hostname === "feltline-ten.vercel.app") return true;
    if (u.hostname.endsWith(".vercel.app") && u.hostname.includes("feltline")) return true;
    if ((u.hostname === "localhost" || u.hostname === "127.0.0.1") && (u.port === "8080" || u.port === "8081")) return true;
    return false;
  } catch {
    return false;
  }
}

function isPokerUrl(url) {
  return Boolean(url && (url.startsWith("https://www.pokernow.com/games/") || url.startsWith("https://www.pokernow.club/games/")));
}

async function tabsWhere(pred) {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((t) => t.id && pred(t.url || ""));
}

async function fanout(pred, msg) {
  const tabs = await tabsWhere(pred);
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, msg, () => void chrome.runtime.lastError);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.source !== "table-coach") return;
  if (msg.type === "hud.ready") {
    chrome.storage.session.get(["lastState"]).then((data) => {
      if (data.lastState && sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, data.lastState, () => void chrome.runtime.lastError);
      }
      sendResponse({ ok: true, hasState: Boolean(data.lastState) });
    });
    return true;
  }
  if (msg.type === "table.state" || msg.type === "extension.hello" || msg.from === "extension") {
    const url = sender.tab?.url || "";
    chrome.storage.session.set({ lastState: msg, lastPokerUrl: url, lastAt: Date.now() });
    fanout(isHudUrl, msg);
  }
  if (msg.type === "user.decision" || msg.type === "user.autoplay" || msg.type === "ping") {
    fanout(isPokerUrl, msg);
  }
});
