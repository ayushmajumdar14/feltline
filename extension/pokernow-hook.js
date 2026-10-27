/* Runs in the Poker Now page world so we see socket.io / engine.io frames. */
(function hookTransport() {
  function emit(data) {
    if (typeof data !== "string") return;
    if (data.includes("42") || data.includes("registered") || data.includes('"gC"')) {
      window.postMessage({ source: "feltline-pn-frame", frame: data }, "*");
    }
  }

  const OrigWS = window.WebSocket;
  if (OrigWS && !OrigWS.__feltline) {
    function Wrapped(url, protocols) {
      const ws = protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
      ws.addEventListener("message", (ev) => emit(ev.data));
      return ws;
    }
    Wrapped.prototype = OrigWS.prototype;
    Wrapped.CONNECTING = OrigWS.CONNECTING;
    Wrapped.OPEN = OrigWS.OPEN;
    Wrapped.CLOSING = OrigWS.CLOSING;
    Wrapped.CLOSED = OrigWS.CLOSED;
    Wrapped.__feltline = true;
    window.WebSocket = Wrapped;
  }

  if (!window.fetch.__feltline) {
    const origFetch = window.fetch.bind(window);
    window.fetch = async function feltlineFetch(input, init) {
      const res = await origFetch(input, init);
      try {
        const url = typeof input === "string" ? input : input && input.url;
        if (url && String(url).includes("socket.io")) {
          res.clone().text().then(emit).catch(() => {});
        }
      } catch {
        /* ignore */
      }
      return res;
    };
    window.fetch.__feltline = true;
  }

  if (window.XMLHttpRequest && !window.XMLHttpRequest.__feltline) {
    const Orig = window.XMLHttpRequest;
    function X() {
      const xhr = new Orig();
      xhr.addEventListener("load", function () {
        try {
          if (String(this.responseURL || "").includes("socket.io")) emit(String(this.responseText || ""));
        } catch {
          /* ignore */
        }
      });
      return xhr;
    }
    X.prototype = Orig.prototype;
    X.__feltline = true;
    window.XMLHttpRequest = X;
  }
})();
