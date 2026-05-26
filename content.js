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
    setTimeout(updateWidget, 300);
  });

  // ── 3. Widget ─────────────────────────────────────────────────────────────

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
    const d = day === 0 ? 1 : 8 - day;
    return `${d}d`;
  }

  // Inject styles once
  const STYLE_ID = "ctt-style";
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #ctt-widget {
        padding: 6px 10px 8px;
        font-family: inherit;
        font-size: 12px;
        line-height: 1.4;
        color: #fff;
        -webkit-font-smoothing: antialiased;
        border-top: 1px solid rgba(255,255,255,.08);
        overflow: hidden;
      }
      #ctt-widget .ctt-head {
        display: flex;
        justify-content: space-between;
        font-size: 10.5px;
        opacity: .45;
        margin-bottom: 7px;
        letter-spacing: .01em;
      }
      #ctt-widget .ctt-row { margin-bottom: 6px; }
      #ctt-widget .ctt-meta {
        display: flex;
        justify-content: space-between;
        margin-bottom: 2px;
        white-space: nowrap;
        overflow: hidden;
      }
      #ctt-widget .ctt-name {
        font-size: 11.5px;
        font-weight: 500;
        opacity: .9;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 58%;
      }
      #ctt-widget .ctt-info {
        font-size: 10.5px;
        opacity: .5;
        flex-shrink: 0;
        margin-left: 4px;
      }
      #ctt-widget .ctt-track {
        height: 3px;
        background: rgba(255,255,255,.12);
        border-radius: 100px;
        overflow: hidden;
      }
      #ctt-widget .ctt-fill {
        height: 100%;
        border-radius: 100px;
        transition: width .4s ease;
        min-width: 2px;
      }
      #ctt-widget .ctt-fill.orange { background: #D97706; }
      #ctt-widget .ctt-fill.orange.warn   { background: #B45309; }
      #ctt-widget .ctt-fill.orange.danger { background: #DC2626; }
      #ctt-widget .ctt-fill.blue { background: #3B82F6; }
    `;
    document.head.appendChild(style);
  }

  // Build widget DOM
  function buildWidget() {
    const w = document.createElement("div");
    w.id = "ctt-widget";
    w.innerHTML = `
      <div class="ctt-head"><span>Token Tracker</span><span>→</span></div>
      <div class="ctt-row">
        <div class="ctt-meta">
          <span class="ctt-name">Diario · todos los modelos</span>
          <span class="ctt-info" id="ctt-d-info">—</span>
        </div>
        <div class="ctt-track"><div class="ctt-fill orange" id="ctt-d-bar" style="width:0%"></div></div>
      </div>
      <div class="ctt-row">
        <div class="ctt-meta">
          <span class="ctt-name">Semanal · todos los modelos</span>
          <span class="ctt-info" id="ctt-w-info">—</span>
        </div>
        <div class="ctt-track"><div class="ctt-fill blue" id="ctt-w-bar" style="width:0%"></div></div>
      </div>
    `;
    return w;
  }

  // Find the correct insertion point using the stable data-testid anchor
  function inject() {
    if (document.getElementById("ctt-widget")) return true;

    const userBtn = document.querySelector('[data-testid="user-menu-button"]');
    if (!userBtn) return false;

    // Walk up 2 levels: button → wrapper div → row div (the one to insert before)
    const userRow = userBtn.parentElement?.parentElement;
    const container = userRow?.parentElement;
    if (!container || !userRow) return false;

    ensureStyles();
    container.insertBefore(buildWidget(), userRow);
    return true;
  }

  // Fill widget with real stats
  async function updateWidget() {
    const dBar  = document.getElementById("ctt-d-bar");
    const wBar  = document.getElementById("ctt-w-bar");
    const dInfo = document.getElementById("ctt-d-info");
    const wInfo = document.getElementById("ctt-w-info");
    if (!dBar) return;

    const stats = await new Promise(r =>
      chrome.runtime.sendMessage({ type: "GET_STATS" }, r)
    );
    if (!stats) return;

    const { today, week, limits } = stats;
    const dTotal = today.input + today.output;
    const wTotal = week.input + week.output;
    const dPct = limits.daily  > 0 ? Math.min(100, (dTotal / limits.daily)  * 100) : 0;
    const wPct = limits.weekly > 0 ? Math.min(100, (wTotal / limits.weekly) * 100) : 0;

    dBar.style.width = dPct.toFixed(1) + "%";
    dBar.className = "ctt-fill orange" + (dPct >= 90 ? " danger" : dPct >= 70 ? " warn" : "");
    dInfo.textContent = `${fmt(dTotal)} · restablece ${resetIn("daily")}`;

    wBar.style.width = wPct.toFixed(1) + "%";
    wInfo.textContent = `${fmt(wTotal)} · restablece ${resetIn("weekly")}`;
  }

  // ── 4. Boot: wait for sidebar, inject, refresh ────────────────────────────
  function boot() {
    const ok = inject();
    if (ok) {
      updateWidget();
      return;
    }
    // Sidebar not ready — watch DOM
    const obs = new MutationObserver(() => {
      if (inject()) {
        obs.disconnect();
        updateWidget();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Refresh every 60s
  setInterval(updateWidget, 60_000);

  // Re-inject after SPA navigation
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      setTimeout(boot, 800);
    }
  }, 1_000);

})();
