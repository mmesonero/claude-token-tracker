// dashboard.js — refreshes every 60 s; badge always live, goes grey on disconnect

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtReset(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (d - new Date() <= 0) return "";
  // Consistent absolute reset time for both limits: "resets Mon 13:00"
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
  const dReset = fmtReset(usage.five_hour?.resets_at);
  const wReset = fmtReset(usage.seven_day?.resets_at);
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

// ── Update banner ─────────────────────────────────────────────────────────────

async function initUpdateBanner() {
  const { updateAvailable, remoteVersion } = await chrome.storage.local.get([
    "updateAvailable", "remoteVersion",
  ]);

  const banner  = document.getElementById("updateBanner");
  const verEl   = document.getElementById("updateVersion");
  const reloadBtn = document.getElementById("reloadBtn");

  function showBanner(version) {
    verEl.textContent = "v" + version;
    banner.classList.add("visible");
  }

  if (updateAvailable && remoteVersion) showBanner(remoteVersion);

  // React if update check fires while dashboard is open
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.updateAvailable?.newValue && changes.remoteVersion?.newValue) {
      showBanner(changes.remoteVersion.newValue);
    }
  });

  reloadBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "RELOAD" }, () => void chrome.runtime.lastError);
  });
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
initUpdateBanner();
