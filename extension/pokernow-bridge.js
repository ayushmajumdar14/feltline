const tracker = new TableTracker();
const SEL = {
  fold: ".game-decisions-ctn .action-buttons button.fold",
  check: ".game-decisions-ctn .action-buttons button.check",
  call: ".game-decisions-ctn .action-buttons button.call",
  raise: ".game-decisions-ctn .action-buttons button.raise",
  raiseInput: ".game-decisions-ctn form.raise-controller-form input.value",
  raiseSubmit: ".game-decisions-ctn form.raise-controller-form input[type=submit].bet",
  raiseBack: ".game-decisions-ctn form.raise-controller-form button.back",
};

function alive() {
  try {
    return Boolean(chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function send(payload) {
  if (!alive()) return false;
  try {
    chrome.runtime.sendMessage(payload, () => {
      void chrome.runtime.lastError;
    });
    return true;
  } catch {
    return false;
  }
}

function visible(sel) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const s = getComputedStyle(el);
  if (s.display === "none" || s.visibility === "hidden" || el.disabled) return null;
  return el;
}

function fillInput(el, value) {
  el.focus();
  el.value = String(value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function clickAction(action, size) {
  const back = visible(SEL.raiseBack);
  if (back) back.click();
  let kind = action;
  if (kind === "fold" && tracker.snapshot().amount_to_call === 0) kind = "check";
  if (kind === "bet" || kind === "raise") {
    const raiseBtn = visible(SEL.raise);
    if (!raiseBtn) {
      kind = tracker.snapshot().amount_to_call > 0 ? "call" : "check";
    } else {
      raiseBtn.click();
      const box = document.querySelector(SEL.raiseInput);
      const submit = document.querySelector(SEL.raiseSubmit);
      if (box && submit && size != null) {
        fillInput(box, Math.round(Number(size)));
        submit.click();
        return true;
      }
    }
  }
  const btn = visible(SEL[kind] || SEL.check);
  if (!btn) return false;
  btn.click();
  return true;
}

function gameId() {
  try {
    const m = location.pathname.match(/\/games\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

function publish() {
  if (!alive()) return;
  tracker.inferMe();
  const hasTable = Boolean(tracker.me || Object.keys(tracker.raw.players || {}).length);
  if (!hasTable) {
    send({ source: "table-coach", from: "extension", type: "extension.hello", game_id: gameId() });
    return;
  }
  send({ source: "table-coach", from: "extension", ...tracker.snapshot() });
}

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.source !== "feltline-pn-frame") return;
  const event = tracker.feed(e.data.frame);
  if (event === "registered" || event === "gC") publish();
});

try {
  chrome.runtime.onMessage.addListener((msg) => {
    if (!alive()) return;
    if (msg?.type === "user.decision") {
      if (msg.decision === "ignore") return;
      clickAction(msg.action, msg.size);
    }
    if (msg?.type === "ping" || msg?.type === "hud.ready") publish();
  });
} catch {
  /* context gone */
}

const tick = setInterval(() => {
  if (!alive()) {
    clearInterval(tick);
    return;
  }
  publish();
}, 1500);

publish();
