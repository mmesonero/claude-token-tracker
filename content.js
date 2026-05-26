// content.js
(function () {
  "use strict";

  // ── 1. Inject fetch interceptor into page context ─────────────────────────
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("page-inject.js");
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);

  // ── 2. Bridge: page → background ──────────────────────────────────────────
  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.data?.type !== "CLAUDE_TOKEN_USAGE") return;
    const { model, inputTokens, outputTokens } = ev.data;
    if (!inputTokens && !outputTokens) return;
    chrome.runtime.sendMessage(
      { type: "UPDATE_USAGE", data: { model, inputTokens: inputTokens || 0, outputTokens: outputTokens || 0 } },
      () => void chrome.runtime.lastError
    );
    setTimeout(updateWidget, 500);
  });

  // ── 3. Helpers ────────────────────────────────────────────────────────────
  function fmt(n) {
    if (!n) return "0";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
    return String(n);
  }
  function pct(n, lim) { return lim > 0 ? Math.min(100, n / lim * 100) : 0; }
  function resetIn(type) {
    const now = new Date();
    if (type === "daily") { const h = 24 - now.getHours(); return h <= 1 ? "<1h" : `${h}h`; }
    const d = now.getDay(); return `${d === 0 ? 1 : 8 - d}d`;
  }

  // ── 4. CSS ────────────────────────────────────────────────────────────────
  function ensureStyles() {
    if (document.getElementById("ctt-style")) return;
    const st = document.createElement("style");
    st.id = "ctt-style";
    st.textContent = `
      #ctt-bar {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 5px 20px 6px;
        margin: 0 8px 6px;
        border-radius: 12px;
        background: transparent;
        font-family: inherit;
        font-size: 11px;
        color: rgba(255,255,255,.45);
        letter-spacing: .01em;
        -webkit-font-smoothing: antialiased;
      }
      .ctt-group {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .ctt-lbl {
        font-size: 10.5px;
        opacity: .7;
        white-space: nowrap;
      }
      .ctt-track {
        width: 80px;
        height: 3px;
        background: rgba(255,255,255,.1);
        border-radius: 100px;
        overflow: hidden;
        flex-shrink: 0;
      }
      .ctt-fill {
        height: 100%;
        border-radius: 100px;
        transition: width .5s ease;
        min-width: 2px;
      }
      .ctt-fill.orange        { background: #D97706; }
      .ctt-fill.orange.warn   { background: #F59E0B; }
      .ctt-fill.orange.danger { background: #EF4444; }
      .ctt-fill.blue          { background: #3B82F6; }
      .ctt-val {
        font-size: 10.5px;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        min-width: 64px;
      }
      .ctt-sep {
        width: 1px;
        height: 11px;
        background: rgba(255,255,255,.12);
        flex-shrink: 0;
      }
    `;
    document.head.appendChild(st);
  }

  // ── 5. DOM ────────────────────────────────────────────────────────────────
  const ID = "ctt-bar";

  function buildBar() {
    const bar = document.createElement("div");
    bar.id = ID;
    bar.innerHTML = `
      <div class="ctt-group">
        <span class="ctt-lbl">Diario</span>
        <div class="ctt-track"><div class="ctt-fill orange" id="ctt-d-fill" style="width:0%"></div></div>
        <span class="ctt-val" id="ctt-d-val">0 · 0%</span>
      </div>
      <div class="ctt-sep"></div>
      <div class="ctt-group">
        <span class="ctt-lbl">Semanal</span>
        <div class="ctt-track"><div class="ctt-fill blue" id="ctt-w-fill" style="width:0%"></div></div>
        <span class="ctt-val" id="ctt-w-val">0 · 0%</span>
      </div>
    `;
    return bar;
  }

  // Insert ABOVE the rounded input box (fieldset's parent), inside its container
  function inject() {
    if (document.getElementById(ID)) return true;

    const fieldset  = document.querySelector('fieldset');
    if (!fieldset) return false;

    const inputBox  = fieldset.parentElement;   // the rounded white/dark box
    const container = inputBox?.parentElement;  // parent that holds the box
    if (!container || !inputBox) return false;

    ensureStyles();
    container.insertBefore(buildBar(), inputBox);
    return true;
  }

  // ── 6. Data ───────────────────────────────────────────────────────────────
  async function updateWidget() {
    const dFill = document.getElementById("ctt-d-fill");
    const wFill = document.getElementById("ctt-w-fill");
    const dVal  = document.getElementById("ctt-d-val");
    const wVal  = document.getElementById("ctt-w-val");
    if (!dFill) return;

    const stats = await new Promise(r =>
      chrome.runtime.sendMessage({ type: "GET_STATS" }, r)
    );
    if (!stats) return;

    const { today, week, limits } = stats;
    const dTotal = today.input + today.output;
    const wTotal = week.input  + week.output;
    const dPct   = pct(dTotal, limits.daily);
    const wPct   = pct(wTotal, limits.weekly);

    dFill.style.width = dPct.toFixed(1) + "%";
    dFill.className   = "ctt-fill orange" + (dPct >= 90 ? " danger" : dPct >= 70 ? " warn" : "");
    dVal.textContent  = `${fmt(dTotal)} · ${dPct.toFixed(0)}% · restablece ${resetIn("daily")}`;

    wFill.style.width = wPct.toFixed(1) + "%";
    wVal.textContent  = `${fmt(wTotal)} · ${wPct.toFixed(0)}% · restablece ${resetIn("weekly")}`;
  }

  // ── 7. Boot ───────────────────────────────────────────────────────────────
  function boot() {
    if (inject()) { updateWidget(); return; }
    const obs = new MutationObserver(() => {
      if (inject()) { obs.disconnect(); updateWidget(); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  setInterval(updateWidget, 60_000);

  // Re-inject after SPA navigation
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      const old = document.getElementById(ID);
      if (old) old.remove();
      setTimeout(boot, 800);
    }
  }, 1_000);

})();
