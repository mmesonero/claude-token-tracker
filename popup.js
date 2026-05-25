// popup.js

// ── Model display names ──────────────────────────────────────────────────────
const MODEL_NAMES = {
  "claude-opus-4-7":            "Opus 4.7",
  "claude-sonnet-4-6":          "Sonnet 4.6",
  "claude-haiku-4-5-20251001":  "Haiku 4.5",
  "claude-3-5-sonnet-20241022": "3.5 Sonnet",
  "claude-3-5-sonnet-20240620": "3.5 Sonnet",
  "claude-3-5-haiku-20241022":  "3.5 Haiku",
  "claude-3-opus-20240229":     "3 Opus",
  "claude-3-sonnet-20240229":   "3 Sonnet",
  "claude-3-haiku-20240307":    "3 Haiku",
  "unknown":                    "Unknown model",
};

function modelDisplay(id) {
  return MODEL_NAMES[id] || id.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

// ── Formatters ───────────────────────────────────────────────────────────────
function fmt(n) {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function fmtAgo(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 5)    return "just now";
  if (s < 60)   return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Progress helpers ─────────────────────────────────────────────────────────
function setBar(el, pct) {
  el.style.width = Math.min(100, Math.max(0, pct)).toFixed(1) + "%";
  el.classList.remove("warn", "danger");
  if (pct >= 90)      el.classList.add("danger");
  else if (pct >= 70) el.classList.add("warn");
}

function pctStr(n, limit) {
  if (!limit) return "—";
  return ((n / limit) * 100).toFixed(1) + "%";
}

// ── Stats loader ─────────────────────────────────────────────────────────────
function loadStats() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_STATS" }, (res) => {
      resolve(
        res || {
          today:   { input: 0, output: 0, models: {} },
          week:    { input: 0, output: 0, models: {} },
          limits:  { daily: 1_000_000, weekly: 7_000_000 },
          history: [],
          lastUpdated: null,
        }
      );
    });
  });
}

// ── Render period (today / week) ─────────────────────────────────────────────
function renderPeriod(prefix, data, limit) {
  const total = data.input + data.output;
  const pct   = limit > 0 ? (total / limit) * 100 : 0;
  const ioMax = total || 1;

  document.getElementById(`${prefix}Total`).textContent = fmt(total);
  document.getElementById(`${prefix}Limit`).textContent = fmt(limit);
  document.getElementById(`${prefix}Pct`).textContent   = pctStr(total, limit);

  setBar(document.getElementById(`${prefix}Bar`), pct);

  const inputPct  = (data.input  / ioMax) * 100;
  const outputPct = (data.output / ioMax) * 100;

  document.getElementById(`${prefix}Input`).textContent  = fmt(data.input);
  document.getElementById(`${prefix}Output`).textContent = fmt(data.output);
  document.getElementById(`${prefix}InputBar`).style.width  = inputPct.toFixed(1)  + "%";
  document.getElementById(`${prefix}OutputBar`).style.width = outputPct.toFixed(1) + "%";
}

// ── Render model list ────────────────────────────────────────────────────────
function renderModels(containerId, models) {
  const el = document.getElementById(containerId);

  if (!models || Object.keys(models).length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="icon">🔍</div>
        <div>No data yet. Start a conversation<br>on <strong>claude.ai</strong>.</div>
      </div>`;
    return;
  }

  const grandTotal = Object.values(models).reduce(
    (s, m) => s + m.input + m.output, 0
  );

  const sorted = Object.entries(models).sort(
    ([, a], [, b]) => (b.input + b.output) - (a.input + a.output)
  );

  el.innerHTML = sorted.map(([id, m]) => {
    const total = m.input + m.output;
    const sharePct = grandTotal > 0 ? (total / grandTotal) * 100 : 0;
    return `
      <div class="model-item">
        <div class="model-header">
          <span class="model-name">${modelDisplay(id)}</span>
          <span class="model-total">${fmt(total)}</span>
        </div>
        <div class="model-bar-track">
          <div class="model-bar-fill" style="width:${sharePct.toFixed(1)}%"></div>
        </div>
        <div class="model-footer">
          <span class="model-io-label">↑ ${fmt(m.input)} in</span>
          <span class="model-io-label">${sharePct.toFixed(0)}% of period</span>
          <span class="model-io-label">↓ ${fmt(m.output)} out</span>
        </div>
      </div>`;
  }).join("");
}

// ── Sparkline canvas ─────────────────────────────────────────────────────────
function drawSparkline(history) {
  const canvas = document.getElementById("sparkCanvas");
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth  || 286;
  const H   = canvas.offsetHeight || 44;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const vals  = history.map((d) => d.total);
  const max   = Math.max(...vals, 1);
  const n     = vals.length;
  const padX  = 4, padY = 6;
  const stepX = (W - padX * 2) / Math.max(n - 1, 1);

  const points = vals.map((v, i) => ({
    x: padX + i * stepX,
    y: padY + (1 - v / max) * (H - padY * 2),
  }));

  // Fill gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(212,103,15,.18)");
  grad.addColorStop(1, "rgba(212,103,15,0)");

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const cx = (points[i - 1].x + points[i].x) / 2;
    ctx.bezierCurveTo(cx, points[i - 1].y, cx, points[i].y, points[i].x, points[i].y);
  }
  ctx.lineTo(points[points.length - 1].x, H);
  ctx.lineTo(points[0].x, H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const cx = (points[i - 1].x + points[i].x) / 2;
    ctx.bezierCurveTo(cx, points[i - 1].y, cx, points[i].y, points[i].x, points[i].y);
  }
  ctx.strokeStyle = "#D4670F";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Dots
  ctx.fillStyle = "#D4670F";
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Day labels (Mon Tue … Sun) — abbreviated
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  ctx.font = `${9 * dpr / dpr}px -apple-system, system-ui, sans-serif`;
  ctx.fillStyle = "#A8A29E";
  ctx.textAlign = "center";
  for (let i = 0; i < history.length; i++) {
    const d = new Date(history[i].date + "T00:00:00");
    ctx.fillText(DAYS[d.getDay()], points[i].x, H - 1);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const stats = await loadStats();

  // Render today
  renderPeriod("today", stats.today, stats.limits.daily);
  renderModels("todayModels", stats.today.models);

  // Render week
  renderPeriod("week", stats.week, stats.limits.weekly);
  renderModels("weekModels", stats.week.models);
  drawSparkline(stats.history || []);

  // Last updated
  const luEl = document.getElementById("lastUpdated");
  luEl.textContent = stats.lastUpdated
    ? `Updated ${fmtAgo(Date.now() - stats.lastUpdated)}`
    : "No data yet — visit claude.ai";

  // ── Tab switching ──────────────────────────────────────────────────────
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));

      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      document.getElementById(tab.dataset.tab).classList.add("active");

      // Redraw sparkline when switching to week (canvas may have been hidden)
      if (tab.dataset.tab === "week") {
        requestAnimationFrame(() => drawSparkline(stats.history || []));
      }
    });
  });

  // ── Settings button ────────────────────────────────────────────────────
  document.getElementById("settingsBtn").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // ── Reset button ───────────────────────────────────────────────────────
  document.getElementById("resetBtn").addEventListener("click", async () => {
    if (!confirm("Reset all usage data?")) return;
    await new Promise((r) =>
      chrome.runtime.sendMessage({ type: "RESET_DATA" }, r)
    );
    window.location.reload();
  });
});
