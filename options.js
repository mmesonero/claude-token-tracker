// options.js

const DEFAULT_LIMITS = { daily: 1_000_000, weekly: 7_000_000 };

function fmt(n) {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function msg(type, data) {
  return new Promise((r) => chrome.runtime.sendMessage({ type, data }, r));
}

// ── Load current settings ─────────────────────────────────────────────────────
async function loadAll() {
  const stats = await msg("GET_STATS");
  const { limits = DEFAULT_LIMITS } = stats;

  document.getElementById("dailyLimit").value  = limits.daily;
  document.getElementById("weeklyLimit").value = limits.weekly;

  // Data section stats
  const usage  = await msg("EXPORT_DATA");
  const keys   = Object.keys(usage || {}).sort();
  const totals  = keys.reduce(
    (acc, k) => acc + (usage[k].input || 0) + (usage[k].output || 0),
    0
  );

  document.getElementById("trackedSince").textContent =
    keys.length ? keys[0] : "—";
  document.getElementById("daysWithData").textContent =
    keys.length ? keys.length : "—";
  document.getElementById("allTimeTotal").textContent =
    totals ? fmt(totals) : "—";

  // Highlight matching preset
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    const match =
      Number(btn.dataset.daily)  === limits.daily &&
      Number(btn.dataset.weekly) === limits.weekly;
    btn.classList.toggle("active", match);
  });
}

// ── Save limits ───────────────────────────────────────────────────────────────
async function saveLimits() {
  const daily  = Number(document.getElementById("dailyLimit").value)  || DEFAULT_LIMITS.daily;
  const weekly = Number(document.getElementById("weeklyLimit").value) || DEFAULT_LIMITS.weekly;

  await msg("SET_LIMITS", { daily, weekly });

  const status = document.getElementById("saveStatus");
  status.textContent = "✓ Saved";
  status.classList.add("show");
  setTimeout(() => status.classList.remove("show"), 2000);

  // Refresh preset highlights
  loadAll();
}

// ── Export ────────────────────────────────────────────────────────────────────
async function exportData() {
  const usage = await msg("EXPORT_DATA");
  const blob  = new Blob([JSON.stringify(usage, null, 2)], { type: "application/json" });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement("a");
  a.href     = url;
  a.download = `claude-token-usage-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Reset ─────────────────────────────────────────────────────────────────────
async function resetData() {
  if (!confirm("Delete all tracked usage data? This cannot be undone.")) return;
  await msg("RESET_DATA");
  loadAll();
}

// ── Wire up ───────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadAll();

  document.getElementById("saveLimits").addEventListener("click", saveLimits);
  document.getElementById("exportBtn").addEventListener("click", exportData);
  document.getElementById("resetBtn").addEventListener("click", resetData);

  // Preset buttons
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("dailyLimit").value  = btn.dataset.daily;
      document.getElementById("weeklyLimit").value = btn.dataset.weekly;
      saveLimits();
    });
  });
});
