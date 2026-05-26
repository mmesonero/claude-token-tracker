// dashboard.js — refreshes every 60 s; badge always live, goes grey on disconnect

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtReset(iso, type) {
  if (!iso) return "";
  const d = new Date(iso), diff = d - new Date();
  if (diff <= 0) return "";
  if (type === "five_hour") {
    const m = Math.ceil(diff / 60_000), h = Math.floor(m / 60);
    return "resets " + (h > 0 ? h + "h " + (m % 60) + "m" : m + "m");
  }
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return "resets " + DAYS[d.getDay()] + " " +
    String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// ── Live badge — always green, goes grey if no data for DISCONNECT_MS ─────────

const DISCONNECT_MS = 90_000; // 90 s without an update → disconnected
let disconnectTimer = null;

function setLive(connected) {
  const badge = document.getElementById("liveBadge");
  if (!badge) return;
  badge.classList.toggle("active", connected);
}

function keepAlive() {
  setLive(true);
  clearTimeout(disconnectTimer);
  disconnectTimer = setTimeout(() => setLive(false), DISCONNECT_MS);
}

// ── Render ────────────────────────────────────────────────────────────────────

function render(usage) {
  const dPct   = usage.five_hour?.utilization ?? 0;
  const wPct   = usage.seven_day?.utilization ?? 0;
  const dReset = fmtReset(usage.five_hour?.resets_at, "five_hour");
  const wReset = fmtReset(usage.seven_day?.resets_at, "seven_day");
  const dColor = dPct >= 90 ? "#EF4444" : dPct >= 70 ? "#F59E0B" : "#D97706";

  document.getElementById("content").innerHTML = `
    <div class="cards">
      <div class="card">
        <div class="card-top">
          <span class="card-label">5-hour limit</span>
          ${dReset ? `<span class="card-reset">${dReset}</span>` : ""}
        </div>
        <div class="bar-row">
          <div class="bar-track">
            <div class="bar-fill" style="width:${Math.min(100, dPct).toFixed(1)}%;background:${dColor}"></div>
          </div>
          <span class="pct" style="color:${dColor}">${dPct.toFixed(0)}%</span>
        </div>
      </div>
      <div class="card">
        <div class="card-top">
          <span class="card-label">Weekly</span>
          ${wReset ? `<span class="card-reset">${wReset}</span>` : ""}
        </div>
        <div class="bar-row">
          <div class="bar-track">
            <div class="bar-fill" style="width:${Math.min(100, wPct).toFixed(1)}%;background:#3B82F6"></div>
          </div>
          <span class="pct" style="color:#3B82F6">${wPct.toFixed(0)}%</span>
        </div>
      </div>
    </div>`;

  document.getElementById("updated").textContent =
    "Updated at " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  keepAlive();
}

function showWaiting() {
  document.getElementById("content").innerHTML =
    `<div class="state">Loading…<small>Fetching usage from claude.ai.</small></div>`;
}

// ── Storage load ──────────────────────────────────────────────────────────────

async function loadFromStorage() {
  const { liveUsage } = await chrome.storage.local.get("liveUsage");
  if (liveUsage) { render(liveUsage); return true; }
  return false;
}

function requestRefresh() {
  chrome.runtime.sendMessage({ type: "REFRESH_USAGE" }, () => void chrome.runtime.lastError);
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  // Show cached data immediately; badge starts live
  const hasCached = await loadFromStorage();
  if (!hasCached) showWaiting();

  // Kick off a fresh fetch right away
  requestRefresh();

  // React instantly whenever background stores new live usage
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.liveUsage?.newValue) {
      render(changes.liveUsage.newValue);
    }
  });

  // Poll every 60 s as fallback (storage.onChanged handles instant updates)
  setInterval(requestRefresh, 60_000);
}

init();
