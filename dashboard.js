// dashboard.js — auto-refreshes every 60 s; reacts instantly to storage changes

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

// ── Live badge flash ──────────────────────────────────────────────────────────

function flashLive() {
  const badge = document.getElementById("liveBadge");
  if (!badge) return;
  badge.classList.remove("active");
  // force reflow so animation restarts
  void badge.offsetWidth;
  badge.classList.add("active");
  // fade out after animation
  clearTimeout(flashLive._timer);
  flashLive._timer = setTimeout(() => badge.classList.remove("active"), 2000);
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

  flashLive();
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

// ── Countdown (1-second tick) ─────────────────────────────────────────────────

const REFRESH_INTERVAL = 60; // seconds
let secondsLeft = REFRESH_INTERVAL;

function tickCountdown() {
  secondsLeft--;
  const el = document.getElementById("countdown");
  if (el) el.textContent = secondsLeft;

  if (secondsLeft <= 0) {
    secondsLeft = REFRESH_INTERVAL;
    requestRefresh();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  // Show cached data immediately if available
  const hasCached = await loadFromStorage();
  if (!hasCached) showWaiting();

  // Kick off a fresh fetch right away
  requestRefresh();

  // React instantly whenever background stores new live usage
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.liveUsage?.newValue) {
      render(changes.liveUsage.newValue);
      // Reset countdown so it reflects actual last-refresh time
      secondsLeft = REFRESH_INTERVAL;
      const el = document.getElementById("countdown");
      if (el) el.textContent = secondsLeft;
    }
  });

  // Tick every second for countdown display; refresh every 60 s
  setInterval(tickCountdown, 1_000);
}

init();
