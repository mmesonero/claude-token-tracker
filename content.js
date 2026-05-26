// content.js
(function () {
  "use strict";

  // ── 1. Inject fetch interceptor ───────────────────────────────────────────
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("page-inject.js");
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);

  // ── 2. Bridge usage events → background ──────────────────────────────────
  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.data?.type !== "CLAUDE_TOKEN_USAGE") return;
    const { model, inputTokens, outputTokens } = ev.data;
    if (!inputTokens && !outputTokens) return;
    chrome.runtime.sendMessage(
      { type: "UPDATE_USAGE", data: { model, inputTokens: inputTokens || 0, outputTokens: outputTokens || 0 } },
      () => void chrome.runtime.lastError
    );
    setTimeout(updateWidget, 400);
  });

  // ── 3. Helpers ────────────────────────────────────────────────────────────
  function fmt(n) {
    if (!n) return "0";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return String(n);
  }
  function resetIn(type) {
    const now = new Date();
    if (type === "daily") { const h = 24 - now.getHours(); return h <= 1 ? "<1h" : `${h}h`; }
    const day = now.getDay();
    return `${day === 0 ? 1 : 8 - day}d`;
  }

  // ── 4. Widget ─────────────────────────────────────────────────────────────
  const ID = "ctt-row";

  function ensureStyles() {
    if (document.getElementById("ctt-style")) return;
    const st = document.createElement("style");
    st.id = "ctt-style";
    st.textContent = `
      #ctt-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 12px 6px;
        opacity: .65;
        transition: opacity .2s;
      }
      #ctt-row:hover { opacity: 1; }
      .ctt-lbl {
        font-size: 10.5px;
        color: var(--text-200, rgba(255,255,255,.5));
        white-space: nowrap;
        min-width: 38px;
        font-family: inherit;
      }
      .ctt-track {
        flex: 1;
        height: 3px;
        background: var(--bg-300, rgba(255,255,255,.12));
        border-radius: 100px;
        overflow: hidden;
        max-width: 90px;
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
      .ctt-stat {
        font-size: 10.5px;
        color: var(--text-200, rgba(255,255,255,.5));
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        min-width: 68px;
        font-family: inherit;
      }
      .ctt-sep {
        width: 1px;
        height: 10px;
        background: rgba(255,255,255,.15);
        flex-shrink: 0;
        margin: 0 2px;
      }
    `;
    document.head.appendChild(st);
  }

  function buildRow() {
    const row = document.createElement("div");
    row.id = ID;
    row.innerHTML = `
      <span class="ctt-lbl">Diario</span>
      <div class="ctt-track"><div class="ctt-fill orange" id="ctt-d-fill" style="width:0%"></div></div>
      <span class="ctt-stat" id="ctt-d-stat">0 · 0%</span>
      <div class="ctt-sep"></div>
      <span class="ctt-lbl">Semanal</span>
      <div class="ctt-track"><div class="ctt-fill blue" id="ctt-w-fill" style="width:0%"></div></div>
      <span class="ctt-stat" id="ctt-w-stat">0 · 0%</span>
    `;
    return row;
  }

  // Inject as last child of the chat fieldset (below the toolbar row)
  function inject() {
    if (document.getElementById(ID)) return true;
    const fieldset = document.querySelector('fieldset.flex.w-full')
                  || document.querySelector('fieldset');
    if (!fieldset) return false;
    ensureStyles();
    fieldset.appendChild(buildRow());
    return true;
  }

  // ── 5. Update data ────────────────────────────────────────────────────────
  async function updateWidget() {
    const dFill = document.getElementById("ctt-d-fill");
    const wFill = document.getElementById("ctt-w-fill");
    const dStat = document.getElementById("ctt-d-stat");
    const wStat = document.getElementById("ctt-w-stat");
    if (!dFill) return;

    const stats = await new Promise(r =>
      chrome.runtime.sendMessage({ type: "GET_STATS" }, r)
    );
    if (!stats) return;

    const { today, week, limits } = stats;
    const dTotal = today.input + today.output;
    const wTotal = week.input + week.output;
    const dPct = limits.daily  > 0 ? Math.min(100, dTotal / limits.daily  * 100) : 0;
    const wPct = limits.weekly > 0 ? Math.min(100, wTotal / limits.weekly * 100) : 0;

    dFill.style.width = dPct.toFixed(1) + "%";
    dFill.className = "ctt-fill orange" + (dPct >= 90 ? " danger" : dPct >= 70 ? " warn" : "");
    dStat.textContent = `${fmt(dTotal)} · ${dPct.toFixed(0)}%`;

    wFill.style.width = wPct.toFixed(1) + "%";
    wStat.textContent = `${fmt(wTotal)} · ${wPct.toFixed(0)}%`;
  }

  // ── 6. Boot ───────────────────────────────────────────────────────────────
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

  // Re-inject on SPA navigation
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
