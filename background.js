// background.js — Service Worker
// Manages storage, aggregates stats, handles messages from popup and content scripts.

const DEFAULT_LIMITS = {
  daily: 1_000_000,
  weekly: 7_000_000,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateKey(date = new Date()) {
  return date.toISOString().split("T")[0]; // "2026-05-25"
}

function weekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  return dateKey(d);
}

function mergeModelData(target, source) {
  for (const [model, data] of Object.entries(source)) {
    if (!target[model]) target[model] = { input: 0, output: 0 };
    target[model].input += data.input || 0;
    target[model].output += data.output || 0;
  }
}

// ─── Storage ──────────────────────────────────────────────────────────────────

async function readStorage() {
  return chrome.storage.local.get(["usage", "limits", "lastUpdated"]);
}

async function updateUsage({ model, inputTokens, outputTokens }) {
  const { usage = {} } = await readStorage();

  const today = dateKey();
  if (!usage[today]) usage[today] = { input: 0, output: 0, models: {} };

  usage[today].input += inputTokens || 0;
  usage[today].output += outputTokens || 0;

  const modelKey = model || "unknown";
  if (!usage[today].models[modelKey])
    usage[today].models[modelKey] = { input: 0, output: 0 };
  usage[today].models[modelKey].input += inputTokens || 0;
  usage[today].models[modelKey].output += outputTokens || 0;

  // Prune entries older than 30 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  for (const key of Object.keys(usage)) {
    if (new Date(key) < cutoff) delete usage[key];
  }

  await chrome.storage.local.set({ usage, lastUpdated: Date.now() });
}

async function getStats() {
  const { usage = {}, limits = DEFAULT_LIMITS, lastUpdated } = await readStorage();

  const today = dateKey();
  const wStart = weekStart();

  // Build today totals
  const todayData = usage[today]
    ? { input: usage[today].input, output: usage[today].output, models: usage[today].models }
    : { input: 0, output: 0, models: {} };

  // Build week totals (Mon → today)
  const weekData = { input: 0, output: 0, models: {} };
  const wDate = new Date(wStart);
  for (let i = 0; i < 7; i++) {
    const key = dateKey(wDate);
    if (usage[key]) {
      weekData.input += usage[key].input;
      weekData.output += usage[key].output;
      mergeModelData(weekData.models, usage[key].models || {});
    }
    wDate.setDate(wDate.getDate() + 1);
  }

  // 7-day history for sparkline (last 7 days)
  const history = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    const day = usage[key] || { input: 0, output: 0 };
    history.push({
      date: key,
      total: day.input + day.output,
      input: day.input,
      output: day.output,
    });
  }

  return { today: todayData, week: weekData, limits, lastUpdated, history };
}

async function setLimits({ daily, weekly }) {
  const limits = { daily: Number(daily), weekly: Number(weekly) };
  await chrome.storage.local.set({ limits });
}

async function resetData() {
  await chrome.storage.local.remove(["usage", "lastUpdated"]);
}

async function exportData() {
  const { usage = {} } = await readStorage();
  return usage;
}

// ─── Fetch usage directly from background (uses Chrome's cookie store) ───────

async function getOrgId() {
  // Cookie via chrome.cookies API (most reliable)
  try {
    const cookie = await chrome.cookies.get({ url: "https://claude.ai", name: "lastActiveOrg" });
    if (cookie?.value) return cookie.value;
  } catch (_) {}
  return null;
}

async function fetchLiveUsage() {
  const orgId = await getOrgId();
  if (!orgId) return null;
  try {
    const r = await fetch(`https://claude.ai/api/organizations/${orgId}/usage`, {
      credentials: "include",
    });
    if (!r.ok) return null;
    const data = await r.json();
    await chrome.storage.local.set({ liveUsage: data, liveUsageAt: Date.now() });
    return data;
  } catch {
    return null;
  }
}

// ─── Open dashboard as a centered popup window ───────────────────────────────

const DASH_W = 400;
const DASH_H = 420;
const DASH_URL_PATH = "dashboard.html";

// Service workers in MV3 are killed when idle, so module-scoped variables
// don't survive. Persist the popup-window id in session storage and also
// fall back to a URL-based lookup so we never open duplicate popups.
async function findDashWindow() {
  const dashUrl = chrome.runtime.getURL(DASH_URL_PATH);
  const { dashWindowId } = await chrome.storage.session.get("dashWindowId");
  if (dashWindowId != null) {
    try {
      const w = await chrome.windows.get(dashWindowId);
      if (w) return w.id;
    } catch { /* window was closed */ }
  }
  // Fallback: scan all popup windows for one already pointing at dashboard.html
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ["popup"] });
  for (const w of wins) {
    if (w.tabs?.some(t => t.url === dashUrl)) {
      await chrome.storage.session.set({ dashWindowId: w.id });
      return w.id;
    }
  }
  return null;
}

chrome.action.onClicked.addListener(async () => {
  const existing = await findDashWindow();
  if (existing != null) {
    try { await chrome.windows.update(existing, { focused: true }); return; }
    catch { /* fall through and recreate */ }
  }

  // Center relative to the current browser window
  const cur  = await chrome.windows.getCurrent();
  const left = Math.round(cur.left + (cur.width  - DASH_W) / 2);
  const top  = Math.round(cur.top  + (cur.height - DASH_H) / 2);

  const win = await chrome.windows.create({
    url:    chrome.runtime.getURL(DASH_URL_PATH),
    type:   "popup",
    width:  DASH_W,
    height: DASH_H,
    left,
    top,
  });
  await chrome.storage.session.set({ dashWindowId: win.id });
});

// Clean up tracked ID when the window is closed
chrome.windows.onRemoved.addListener(async (windowId) => {
  const { dashWindowId } = await chrome.storage.session.get("dashWindowId");
  if (windowId === dashWindowId) await chrome.storage.session.remove("dashWindowId");
});

// ─── Auto-update check ───────────────────────────────────────────────────────

const REMOTE_MANIFEST =
  "https://raw.githubusercontent.com/mmesonero/claude-token-tracker/master/manifest.json";
const UPDATE_ALARM = "ctt-update-check";

function compareVersion(a, b) {
  const A = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const B = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] || 0, y = B[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

async function checkForUpdate() {
  try {
    const r = await fetch(`${REMOTE_MANIFEST}?_=${Date.now()}`); // cache-bust
    if (!r.ok) return;
    const remote = await r.json();
    const local  = chrome.runtime.getManifest().version;
    const hasUpdate = compareVersion(remote.version, local) > 0;

    await chrome.storage.local.set({
      updateAvailable:  hasUpdate,
      remoteVersion:    remote.version,
    });

    if (hasUpdate) {
      chrome.action.setBadgeText({ text: "↑" });
      chrome.action.setBadgeBackgroundColor({ color: "#D4670F" });
    } else {
      chrome.action.setBadgeText({ text: "" });
    }
  } catch {
    // Network unavailable — silently skip
  }
}

// MV3 service workers don't survive idle, so setInterval is unreliable.
// chrome.alarms wakes the worker on schedule.
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) checkForUpdate();
});
// Also run once at every worker wake-up
checkForUpdate();

// ─── Message Listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case "UPDATE_USAGE":
      updateUsage(msg.data).then(() => sendResponse({ ok: true })).catch(console.error);
      return true;

    case "GET_STATS":
      getStats().then(sendResponse).catch(console.error);
      return true;

    case "SET_LIMITS":
      setLimits(msg.data).then(() => sendResponse({ ok: true })).catch(console.error);
      return true;

    case "RESET_DATA":
      resetData().then(() => sendResponse({ ok: true })).catch(console.error);
      return true;

    case "EXPORT_DATA":
      exportData().then(sendResponse).catch(console.error);
      return true;

    case "STORE_USAGE":
      chrome.storage.local.set({ liveUsage: msg.data, liveUsageAt: Date.now() })
        .then(() => sendResponse({ ok: true }));
      return true;

    case "REFRESH_USAGE":
      // Fire and forget — result goes to storage, dashboard listens via onChanged
      fetchLiveUsage().catch(() => {});
      sendResponse({ ok: true });
      return true;

    case "RELOAD":
      sendResponse({ ok: true });
      chrome.runtime.reload();
      return true;
  }
});
