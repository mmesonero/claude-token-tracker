// content.js — Isolated world content script on claude.ai
// 1. Injects fetch interceptor (page-inject.js) into page context
// 2. Bridges token usage events → background
// 3. Injects the "Token Tracker" widget into claude.ai's sidebar

(function () {
  "use strict";

  // ══════════════════════════════════════════════════════════════════════════
  // 1.  Inject fetch interceptor into the PAGE context
  // ══════════════════════════════════════════════════════════════════════════
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("page-inject.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  // ══════════════════════════════════════════════════════════════════════════
  // 2.  Bridge page → background
  // ══════════════════════════════════════════════════════════════════════════
  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.data?.type !== "CLAUDE_TOKEN_USAGE") return;
    const { model, inputTokens, outputTokens } = ev.data;
    if (!inputTokens && !outputTokens) return;
    chrome.runtime.sendMessage(
      { type: "UPDATE_USAGE", data: { model, inputTokens: inputTokens || 0, outputTokens: outputTokens || 0 } },
      () => void chrome.runtime.lastError
    );
    // Also refresh the widget with fresh data
    refreshWidget();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3.  Widget
  // ══════════════════════════════════════════════════════════════════════════

  // ── Helpers ─────────────────────────────────────────────────────────────

  function fmt(n) {
    if (!n) return "0";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
    return n.toLocaleString();
  }

  function pct(n, limit) {
    return limit > 0 ? Math.min(100, (n / limit) * 100) : 0;
  }

  function resetIn(targetHour, targetDay) {
    // targetHour = "daily" → midnight, targetDay = "weekly" → next Monday
    const now = new Date();
    if (targetHour === "daily") {
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 0, 0);
      const diffH = Math.ceil((nextMidnight - now) / 3_600_000);
      return diffH <= 1 ? "< 1h" : `${diffH}h`;
    }
    // weekly → next Monday
    const day = now.getDay(); // 0=Sun
    const daysToMon = day === 0 ? 1 : 8 - day;
    return `${daysToMon}d`;
  }

  // ── Styles ───────────────────────────────────────────────────────────────
  // Scoped with #ctt- prefix; matches claude.ai dark sidebar exactly

  const CSS = `
  #ctt-widget {
    padding: 8px 12px 10px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    font-size: 12px;
    line-height: 1.4;
    user-select: none;
    -webkit-font-smoothing: antialiased;
    border-top: 1px solid rgba(255,255,255,.06);
  }
  #ctt-widget .ctt-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    cursor: pointer;
    opacity: .55;
    font-size: 11px;
    letter-spacing: .01em;
    color: inherit;
  }
  #ctt-widget .ctt-header:hover { opacity: .8; }
  #ctt-widget .ctt-row {
    margin-bottom: 7px;
  }
  #ctt-widget .ctt-row-labels {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 3px;
  }
  #ctt-widget .ctt-label {
    font-size: 11.5px;
    font-weight: 500;
    color: inherit;
    opacity: .9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 60%;
  }
  #ctt-widget .ctt-stat {
    font-size: 10.5px;
    opacity: .5;
    white-space: nowrap;
    margin-left: 6px;
    flex-shrink: 0;
  }
  #ctt-widget .ctt-track {
    width: 100%;
    height: 3px;
    background: rgba(255,255,255,.1);
    border-radius: 100px;
    overflow: hidden;
  }
  #ctt-widget .ctt-fill {
    height: 100%;
    border-radius: 100px;
    transition: width .5s ease;
    min-width: 2px;
  }
  #ctt-widget .ctt-fill.orange { background: #D97706; }
  #ctt-widget .ctt-fill.orange.warn   { background: #B45309; }
  #ctt-widget .ctt-fill.orange.danger { background: #DC2626; }
  #ctt-widget .ctt-fill.blue   { background: #3D7AE4; }
  `;

  // ── DOM creation ─────────────────────────────────────────────────────────

  let widget = null;

  function buildWidget() {
    if (document.getElementById("ctt-widget")) return;

    // Inject styles
    if (!document.getElementById("ctt-styles")) {
      const style = document.createElement("style");
      style.id = "ctt-styles";
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    widget = document.createElement("div");
    widget.id = "ctt-widget";
    widget.innerHTML = `
      <div class="ctt-header">
        <span>Token Tracker</span>
        <span>→</span>
      </div>
      <div class="ctt-row" id="ctt-daily">
        <div class="ctt-row-labels">
          <span class="ctt-label">Diario · todos los modelos</span>
          <span class="ctt-stat" id="ctt-daily-stat">—</span>
        </div>
        <div class="ctt-track">
          <div class="ctt-fill orange" id="ctt-daily-fill" style="width:0%"></div>
        </div>
      </div>
      <div class="ctt-row" id="ctt-weekly">
        <div class="ctt-row-labels">
          <span class="ctt-label">Semanal · todos los modelos</span>
          <span class="ctt-stat" id="ctt-weekly-stat">—</span>
        </div>
        <div class="ctt-track">
          <div class="ctt-fill blue" id="ctt-weekly-fill" style="width:0%"></div>
        </div>
      </div>
    `;

    // Open extension popup on click
    widget.querySelector(".ctt-header").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_POPUP" });
    });

    return widget;
  }

  // ── Sidebar injection ─────────────────────────────────────────────────────
  // Try several selectors; claude.ai changes their DOM periodically.

  const SIDEBAR_SELECTORS = [
    // Most specific first
    'nav[aria-label*="plan"]',
    '[data-testid="sidebar-nav"]',
    '[data-testid="sidebar"]',
    'aside nav',
    'aside',
    // Generic nav at the left edge
    'nav',
  ];

  // Items at the bottom of the sidebar we want to insert before
  const BEFORE_SELECTORS = [
    '[data-testid="upgrade-button"]',
    '[href*="settings"]',
    '[href*="billing"]',
    'a[href*="account"]',
  ];

  function findSidebar() {
    for (const sel of SIDEBAR_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function injectWidget() {
    if (document.getElementById("ctt-widget")) return; // already there

    const w = buildWidget();
    if (!w) return;

    const sidebar = findSidebar();

    if (sidebar) {
      // Try to find a "bottom" anchor element to insert before
      let anchor = null;
      for (const sel of BEFORE_SELECTORS) {
        anchor = sidebar.querySelector(sel);
        if (anchor) { anchor = anchor.closest("li, div, a") || anchor; break; }
      }

      if (anchor) {
        anchor.parentNode.insertBefore(w, anchor);
      } else {
        sidebar.appendChild(w);
      }
    } else {
      // Fallback: fixed overlay in the sidebar region
      Object.assign(w.style, {
        position:  "fixed",
        left:      "0",
        bottom:    "64px",
        width:     "240px",
        zIndex:    "2147483647",
        background: "rgba(26,25,24,.96)",
        backdropFilter: "blur(8px)",
        color:     "#FFFDF7",
        borderRadius: "0 8px 8px 0",
        boxShadow: "2px 0 12px rgba(0,0,0,.4)",
      });
      document.body.appendChild(w);
    }
  }

  // ── Data update ───────────────────────────────────────────────────────────

  async function refreshWidget() {
    const stats = await new Promise((r) =>
      chrome.runtime.sendMessage({ type: "GET_STATS" }, r)
    );
    if (!stats) return;

    const { today, week, limits } = stats;
    const dailyTotal  = today.input + today.output;
    const weeklyTotal = week.input  + week.output;
    const dailyPct    = pct(dailyTotal,  limits.daily);
    const weeklyPct   = pct(weeklyTotal, limits.weekly);

    const dailyFill  = document.getElementById("ctt-daily-fill");
    const weeklyFill = document.getElementById("ctt-weekly-fill");
    const dailyStat  = document.getElementById("ctt-daily-stat");
    const weeklyStat = document.getElementById("ctt-weekly-stat");

    if (!dailyFill) return; // widget not yet in DOM

    dailyFill.style.width = dailyPct.toFixed(1) + "%";
    dailyFill.className   = "ctt-fill orange" +
      (dailyPct >= 90 ? " danger" : dailyPct >= 70 ? " warn" : "");
    dailyStat.textContent =
      `${fmt(dailyTotal)} · restablece ${resetIn("daily")}`;

    weeklyFill.style.width = weeklyPct.toFixed(1) + "%";
    weeklyStat.textContent =
      `${fmt(weeklyTotal)} · restablece ${resetIn("weekly")}`;
  }

  // ── MutationObserver — wait for sidebar to appear ────────────────────────

  function startObserver() {
    const observer = new MutationObserver(() => {
      if (!document.getElementById("ctt-widget")) {
        injectWidget();
        if (document.getElementById("ctt-widget")) {
          refreshWidget();
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Also try right now
    injectWidget();
    refreshWidget();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver);
  } else {
    startObserver();
  }

  // Auto-refresh every 60s
  setInterval(refreshWidget, 60_000);
})();
