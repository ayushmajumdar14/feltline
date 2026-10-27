/* Runs in the Poker Now page world so we see socket.io frames. */
(function wrapSockets() {
  const Orig = window.WebSocket;
  if (!Orig || Orig.__feltline) return;
  function Wrapped(url, protocols) {
    const ws = protocols !== undefined ? new Orig(url, protocols) : new Orig(url);
    ws.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") {
        window.postMessage({ source: "feltline-pn-frame", frame: ev.data }, "*");
      }
    });
    return ws;
  }
  Wrapped.prototype = Orig.prototype;
  Wrapped.CONNECTING = Orig.CONNECTING;
  Wrapped.OPEN = Orig.OPEN;
  Wrapped.CLOSING = Orig.CLOSING;
  Wrapped.CLOSED = Orig.CLOSED;
  Wrapped.__feltline = true;
  window.WebSocket = Wrapped;
})();
