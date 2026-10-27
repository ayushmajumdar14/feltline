(function () {
  if (!/feltline/i.test(location.hostname) && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    return;
  }

  function alive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.source !== "table-coach") return;
      window.postMessage({ ...msg, source: "table-coach", from: "extension" }, window.location.origin);
    });
  } catch {
    /* context gone */
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "table-coach") return;
    if (e.data.from === "extension") return;
    if (!alive()) return;
    if (e.data.type === "user.decision" || e.data.type === "user.autoplay" || e.data.type === "hud.ready") {
      try {
        chrome.runtime.sendMessage({ source: "table-coach", ...e.data }, () => void chrome.runtime.lastError);
      } catch {
        /* ignore */
      }
    }
  });

  function announce() {
    if (!alive()) return;
    try {
      chrome.runtime.sendMessage({ source: "table-coach", type: "hud.ready" }, (res) => {
        void chrome.runtime.lastError;
        if (res && res.ok) {
          window.postMessage({ source: "table-coach", from: "extension", type: "extension.hello" }, window.location.origin);
        }
      });
    } catch {
      /* ignore */
    }
  }

  announce();
  setTimeout(announce, 500);
  setTimeout(announce, 2000);
})();
