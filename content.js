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
    if (type === "daily") {
      const h = 24 - now.getHours();
      return h <= 1 ? "< 1h" : `${h}h`;
    }
    const day = now.getDay();
    return `${day === 0 ? 1 : 8 - day}d`;
  }

  // ── 4. Widget — barra fija debajo del input de chat ───────────────────────
  const WIDGET_ID = "ctt-bar";

  function buildWidget() {
    const bar = document.createElement("div");
    bar.id = WIDGET_ID;
    bar.innerHTML = `
      <div class="ctt-section">
        <span class="ctt-label">Diario</span>
        <div class="ctt-track"><div class="ctt-fill orange" id="ctt-d-fill" style="width:0%"></div></div>
        <span class="ctt-stat" id="ctt-d-stat">—</span>
      </div>
      <div class="ctt-divider"></div>
      <div class="ctt-section">
        <span class="ctt-label">Semanal</span>
        <div class="ctt-track"><div class="ctt-fill blue" id="ctt-w-fill" style="width:0%"></div></div>
        <span class="ctt-stat" id="ctt-w-stat">—</span>
      </div>
    `;
    return bar;
  }

  function ensureStyles() {
    if (document.getElementById("ctt-style")) return;
    const st = document.createElement("style");
    st.id = "ctt-style";
    st.textContent = `
      #ctt-bar {
        position: fixed;
        bottom: 14px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 5px 13px;
        background: rgba(31, 31, 30, 0.92);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 100px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        font-size: 11px;
        color: #fff;
        white-space: nowrap;
        box-shadow: 0 2px 12px rgba(0,0,0,.4);
        pointer-events: none;
        -webkit-font-smoothing: antialiased;
        transition: opacity .3s ease;
      }
      #ctt-bar:hover { opacity: .6; }
      .ctt-section {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .ctt-label {
        font-size: 10px;
        opacity: .5;
        letter-spacing: .02em;
      }
      .ctt-track {
        width: 72px;
        height: 3px;
        background: rgba(255,255,255,.15);
        border-radius: 100px;
        overflow: hidden;
      }
      .ctt-fill {
        height: 100%;
        border-radius: 100px;
        transition: width .5s ease;
        min-width: 2px;
      }
      .ctt-fill.orange       { background: #D97706; }
      .ctt-fill.orange.warn  { background: #F59E0B; }
      .ctt-fill.orange.danger{ background: #EF4444; }
      .ctt-fill.blue         { background: #3B82F6; }
      .ctt-stat {
        font-size: 10.5px;
        opacity: .7;
        font-variant-numeric: tabular-nums;
        min-width: 52px;
      }
      .ctt-divider {
        width: 1px;
        height: 12px;
        background: rgba(255,255,255,.15);
        flex-shrink: 0;
      }
    `;
    document.head.appendChild(st);
  }

  function inject() {
    if (document.getElementById(WIDGET_ID)) return;
    ensureStyles();
    document.body.appendChild(buildWidget());
  }

  // ── 5. Data update ────────────────────────────────────────────────────────
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
    inject();
    updateWidget();
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
      const old = document.getElementById(WIDGET_ID);
      if (old) old.remove();
      setTimeout(boot, 600);
    }
  }, 1_000);

})();
