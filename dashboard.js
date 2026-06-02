// dashboard.js — refreshes every 60 s; expandable cards; live badge

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtReset(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (d - new Date() <= 0) return "";
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return "resets " + DAYS[d.getDay()] + " " +
    String(d.getHours()).padStart(2, "0") + ":" +
    String(d.getMinutes()).padStart(2, "0");
}

function fmtTokens(n) {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function fmtCountdown(iso) {
  if (!iso) return "";
  const ms = new Date(iso) - new Date();
  if (ms <= 0) return "soon";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return Math.floor(h / 24) + "d " + (h % 24) + "h";
  if (h > 0) return h + "h " + m + "m";
  return m + "m";
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function prettyModel(name) {
  return escHtml(String(name)
    .replace(/^claude-/, "")
    .replace(/-\d{8}.*$/, "")
    .replace(/-/g, " ")
    .replace(/(\d) (\d)/g, "$1.$2")
    .replace(/\b\w/g, c => c.toUpperCase()));
}

// ── Live badge ───────────────────────────────────────────────────────────────

const DISCONNECT_MS = 90_000;
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

// ── State ────────────────────────────────────────────────────────────────────

let expandedCard = null;
let localStats = null;

// ── Fetch local tracking stats ───────────────────────────────────────────────

async function fetchLocalStats() {
  try {
    return await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "GET_STATS" }, (r) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(r);
      });
    });
  } catch { return null; }
}

// ── Build expanded detail HTML ───────────────────────────────────────────────

function buildDetails(type, usage) {
  const isDaily = type === "daily";
  const reset = isDaily ? usage?.five_hour?.resets_at : usage?.seven_day?.resets_at;
  const countdown = fmtCountdown(reset);
  const data = localStats ? (isDaily ? localStats.today : localStats.week) : null;

  let html = '<div class="detail-divider"></div>';
  let hasContent = false;

  if (countdown) {
    html += `<div class="detail-row">
      <span class="detail-label">Resets in</span>
      <span class="detail-value">${countdown}</span>
    </div>`;
    hasContent = true;
  }

  if (data) {
    const total = (data.input || 0) + (data.output || 0);
    if (total > 0) {
      html += `<div class="detail-row">
        <span class="detail-label">${isDaily ? "Today" : "This week"}</span>
        <span class="detail-value">${fmtTokens(total)} tokens</span>
      </div>`;
      html += `<div class="detail-row">
        <span class="detail-label">In / Out</span>
        <span class="detail-value">${fmtTokens(data.input)} / ${fmtTokens(data.output)}</span>
      </div>`;
      hasContent = true;
    }

    const models = data.models || {};
    const entries = Object.entries(models)
      .sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output));
    if (entries.length) {
      html += `<div class="detail-heading">Models</div>`;
      for (const [name, m] of entries) {
        html += `<div class="model-row">
          <span class="model-name">${prettyModel(name)}</span>
          <span class="model-tokens">${fmtTokens(m.input + m.output)}</span>
        </div>`;
      }
      hasContent = true;
    }
  }

  if (!isDaily && localStats?.history?.length) {
    const hist = localStats.history;
    const maxVal = Math.max(...hist.map(h => h.total), 1);
    const DAYS = ["S","M","T","W","T","F","S"];

    html += `<div class="detail-heading">Last 7 days</div>`;
    html += `<div class="sparkline">`;
    for (let i = 0; i < hist.length; i++) {
      const pct = (hist[i].total / maxVal * 100);
      const cls = i === hist.length - 1 ? " today" : "";
      html += `<div class="spark-bar${cls}" style="height:${Math.max(4, pct)}%"></div>`;
    }
    html += `</div><div class="spark-days">`;
    for (const h of hist) {
      html += `<span>${DAYS[new Date(h.date + "T12:00:00").getDay()]}</span>`;
    }
    html += `</div>`;
    hasContent = true;
  }

  if (!hasContent) html += `<div class="detail-empty">No data yet</div>`;
  return html;
}

// ── Render ────────────────────────────────────────────────────────────────────

function render(usage) {
  const dPct   = usage.five_hour?.utilization ?? 0;
  const wPct   = usage.seven_day?.utilization ?? 0;
  const dReset = fmtReset(usage.five_hour?.resets_at);
  const wReset = fmtReset(usage.seven_day?.resets_at);
  const dColor = dPct >= 90 ? "#EF4444" : dPct >= 70 ? "#F59E0B" : "#D97706";

  const prev = expandedCard;

  document.getElementById("content").innerHTML = `
    <div class="cards">
      <div class="card${prev === 'daily' ? ' expanded no-anim' : ''}" data-card="daily">
        <div class="card-top">
          <span class="card-label">5-hour limit <span class="chevron">▾</span></span>
          ${dReset ? `<span class="card-reset">${dReset}</span>` : ""}
        </div>
        <div class="bar-row">
          <div class="bar-track">
            <div class="bar-fill" style="width:${Math.min(100, dPct).toFixed(1)}%;background:${dColor}"></div>
          </div>
          <span class="pct" style="color:${dColor}">${dPct.toFixed(0)}%</span>
        </div>
        <div class="card-details">
          ${buildDetails('daily', usage)}
        </div>
      </div>
      <div class="card${prev === 'weekly' ? ' expanded no-anim' : ''}" data-card="weekly">
        <div class="card-top">
          <span class="card-label">Weekly <span class="chevron">▾</span></span>
          ${wReset ? `<span class="card-reset">${wReset}</span>` : ""}
        </div>
        <div class="bar-row">
          <div class="bar-track">
            <div class="bar-fill" style="width:${Math.min(100, wPct).toFixed(1)}%;background:#3B82F6"></div>
          </div>
          <span class="pct" style="color:#3B82F6">${wPct.toFixed(0)}%</span>
        </div>
        <div class="card-details">
          ${buildDetails('weekly', usage)}
        </div>
      </div>
    </div>`;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll('.no-anim').forEach(el => el.classList.remove('no-anim'));
    });
  });

  document.querySelectorAll('.card[data-card]').forEach(card => {
    card.addEventListener('click', async () => {
      const key = card.dataset.card;
      if (expandedCard === key) {
        expandedCard = null;
        card.classList.remove('expanded');
        return;
      }
      document.querySelectorAll('.card.expanded').forEach(c => c.classList.remove('expanded'));
      expandedCard = key;
      card.classList.add('expanded');
      // Refresh local stats before showing details — they may be stale up to 60 s
      const fresh = await fetchLocalStats();
      if (fresh) {
        localStats = fresh;
        const { liveUsage } = await chrome.storage.local.get("liveUsage");
        if (liveUsage) render(liveUsage);
      }
    });
  });

  document.getElementById("updated").textContent =
    "Updated at " + new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });

  keepAlive();
}

function showWaiting() {
  document.getElementById("content").innerHTML =
    `<div class="state">Loading…<small>Fetching usage from claude.ai.</small></div>`;
}

// ── Storage ──────────────────────────────────────────────────────────────────

function requestRefresh() {
  chrome.runtime.sendMessage({ type: "REFRESH_USAGE" }, () => void chrome.runtime.lastError);
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const [cached, stats] = await Promise.all([
    chrome.storage.local.get("liveUsage").then(r => r.liveUsage || null),
    fetchLocalStats(),
  ]);
  localStats = stats;

  if (cached) render(cached);
  else showWaiting();

  requestRefresh();

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === "local" && changes.liveUsage?.newValue) {
      localStats = await fetchLocalStats();
      render(changes.liveUsage.newValue);
    }
  });

  setInterval(async () => {
    if (document.hidden) return; // skip while the popup window isn't visible
    localStats = await fetchLocalStats();
    requestRefresh();
  }, 60_000);

  // Refresh immediately when the window becomes visible again
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) return;
    localStats = await fetchLocalStats();
    requestRefresh();
  });
}

init();
