// content.js
(function () {
  "use strict";

  // ── 1. Inject fetch interceptor ───────────────────────────────────────────
  const sc = document.createElement("script");
  sc.src = chrome.runtime.getURL("page-inject.js");
  sc.onload = () => sc.remove();
  (document.head || document.documentElement).appendChild(sc);

  // ── 2. Bridge: page → background (token counting) ────────────────────────
  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.data?.type !== "CLAUDE_TOKEN_USAGE") return;
    const { model, inputTokens, outputTokens } = ev.data;
    if (!inputTokens && !outputTokens) return;
    chrome.runtime.sendMessage(
      { type: "UPDATE_USAGE", data: { model, inputTokens: inputTokens || 0, outputTokens: outputTokens || 0 } },
      () => void chrome.runtime.lastError
    );
  });

  // ── 3. API: get org ID + real usage ──────────────────────────────────────

  async function getOrgId() {
    // Method 1: cookie (most reliable on claude.ai)
    const m = document.cookie.match(/lastActiveOrg=([a-f0-9-]{36})/);
    if (m) return m[1];

    // Method 2: __NEXT_DATA__
    try {
      const id = window.__NEXT_DATA__?.props?.pageProps?.bootstrapData?.organization?.uuid;
      if (id) return id;
    } catch (_) {}

    // Method 3: bootstrap API
    try {
      const r = await fetch("/api/bootstrap", { credentials: "include" });
      const d = await r.json();
      return d?.organization?.uuid || d?.account?.organization_uuid || null;
    } catch (_) {}

    return null;
  }

  async function fetchUsage() {
    const orgId = await getOrgId();
    if (!orgId) return null;
    try {
      const r = await fetch(`/api/organizations/${orgId}/usage`, { credentials: "include" });
      if (!r.ok) return null;
      return await r.json();
    } catch (_) { return null; }
  }

  // ── 4. Format helpers ─────────────────────────────────────────────────────

  function fmtReset(isoString, type) {
    if (!isoString) return "";
    const d = new Date(isoString);
    const now = new Date();
    const diffMs = d - now;
    if (diffMs <= 0) return "";

    if (type === "five_hour") {
      // Show as relative: "4h 26m"
      const totalMin = Math.ceil(diffMs / 60_000);
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    } else {
      // Show as absolute day + time: "lun 11:00"
      const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
      const hh = d.getHours().toString().padStart(2, "0");
      const mm = d.getMinutes().toString().padStart(2, "0");
      return `${DAYS[d.getDay()]} ${hh}:${mm}`;
    }
  }

  // ── 5. Widget CSS ─────────────────────────────────────────────────────────

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
        padding: 5px 16px;
        margin: 4px 8px 0;
        font-family: inherit;
        font-size: 11px;
        color: rgba(255,255,255,.4);
        -webkit-font-smoothing: antialiased;
        letter-spacing: .01em;
      }
      .ctt-group {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .ctt-lbl {
        font-size: 10.5px;
        white-space: nowrap;
        opacity: .8;
      }
      .ctt-track {
        width: 76px;
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
      }
      .ctt-sep {
        width: 1px;
        height: 11px;
        background: rgba(255,255,255,.12);
        flex-shrink: 0;
        margin: 0 1px;
      }
    `;
    document.head.appendChild(st);
  }

  // ── 6. DOM build ──────────────────────────────────────────────────────────

  const ID = "ctt-bar";

  function buildBar() {
    const bar = document.createElement("div");
    bar.id = ID;
    bar.innerHTML = `
      <div class="ctt-group">
        <span class="ctt-lbl">Sesión</span>
        <div class="ctt-track"><div class="ctt-fill orange" id="ctt-d-fill" style="width:0%"></div></div>
        <span class="ctt-val" id="ctt-d-val">—</span>
      </div>
      <div class="ctt-sep"></div>
      <div class="ctt-group">
        <span class="ctt-lbl">Semanal</span>
        <div class="ctt-track"><div class="ctt-fill blue" id="ctt-w-fill" style="width:0%"></div></div>
        <span class="ctt-val" id="ctt-w-val">—</span>
      </div>
    `;
    return bar;
  }

  // Insert BELOW the rounded input box
  function inject() {
    if (document.getElementById(ID)) return true;
    const fieldset  = document.querySelector("fieldset");
    if (!fieldset)  return false;
    const inputBox  = fieldset.parentElement;
    const container = inputBox?.parentElement;
    if (!container || !inputBox) return false;
    ensureStyles();
    // insertBefore(bar, inputBox.nextSibling) = after the input box
    container.insertBefore(buildBar(), inputBox.nextSibling);
    return true;
  }

  // ── 7. Update widget with real API data ───────────────────────────────────

  async function updateWidget() {
    const dFill = document.getElementById("ctt-d-fill");
    const wFill = document.getElementById("ctt-w-fill");
    const dVal  = document.getElementById("ctt-d-val");
    const wVal  = document.getElementById("ctt-w-val");
    if (!dFill) return;

    const usage = await fetchUsage();
    if (!usage) {
      dVal.textContent = "sin datos";
      wVal.textContent = "sin datos";
      return;
    }

    const dPct = usage.five_hour?.utilization ?? 0;
    const wPct = usage.seven_day?.utilization ?? 0;
    const dReset = fmtReset(usage.five_hour?.resets_at, "five_hour");
    const wReset = fmtReset(usage.seven_day?.resets_at, "seven_day");

    dFill.style.width = Math.min(100, dPct).toFixed(0) + "%";
    dFill.className   = "ctt-fill orange" + (dPct >= 90 ? " danger" : dPct >= 70 ? " warn" : "");
    dVal.textContent  = `${dPct.toFixed(0)}%` + (dReset ? ` · ${dReset}` : "");

    wFill.style.width = Math.min(100, wPct).toFixed(0) + "%";
    wVal.textContent  = `${wPct.toFixed(0)}%` + (wReset ? ` · ${wReset}` : "");
  }

  // ── 8. Boot ───────────────────────────────────────────────────────────────

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

  // Refresh data every 5 min
  setInterval(updateWidget, 5 * 60_000);

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
