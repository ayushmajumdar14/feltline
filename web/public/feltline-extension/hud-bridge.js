chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.source !== "table-coach") return;
  window.postMessage({ ...msg, source: "table-coach", from: "extension" }, window.location.origin);
});

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.source !== "table-coach") return;
  if (e.data.from === "extension") return;
  if (e.data.type === "user.decision" || e.data.type === "user.autoplay") {
    chrome.runtime.sendMessage({ source: "table-coach", ...e.data }).catch(() => {});
  }
});

chrome.runtime.sendMessage({ source: "table-coach", type: "ping" }).catch(() => {});
