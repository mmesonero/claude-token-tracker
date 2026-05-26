function fmtReset(iso, type) {
  if (!iso) return "";
  const d = new Date(iso), diff = d - new Date();
  if (diff <= 0) return "";
  if (type === "five_hour") {
    const m = Math.ceil(diff / 60000), h = Math.floor(m / 60);
    return "reset " + (h > 0 ? h + "h " + (m % 60) + "m" : m + "m");
  }
  const DAYS = ["dom","lun","mar","mié","jue","vie","sáb"];
  return "reset " + DAYS[d.getDay()] + " " +
    String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0");
}

function render(usage) {
  const dPct   = usage.five_hour?.utilization  ?? 0;
  const wPct   = usage.seven_day?.utilization  ?? 0;
  const dReset = fmtReset(usage.five_hour?.resets_at, "five_hour");
  const wReset = fmtReset(usage.seven_day?.resets_at, "seven_day");
  const dColor = dPct >= 90 ? "#EF4444" : dPct >= 70 ? "#F59E0B" : "#D97706";

  document.getElementById("content").innerHTML = `
    <div class="cards">
      <div class="card">
        <div class="card-top">
          <span class="card-label">Sesión · 5h</span>
          ${dReset ? `<span class="card-reset">${dReset}</span>` : ""}
        </div>
        <div class="bar-row">
          <div class="bar-track">
            <div class="bar-fill" style="width:${Math.min(100,dPct).toFixed(1)}%;background:${dColor}"></div>
          </div>
          <span class="pct" style="color:${dColor}">${dPct.toFixed(0)}%</span>
        </div>
      </div>
      <div class="card">
        <div class="card-top">
          <span class="card-label">Semanal</span>
          ${wReset ? `<span class="card-reset">${wReset}</span>` : ""}
        </div>
        <div class="bar-row">
          <div class="bar-track">
            <div class="bar-fill" style="width:${Math.min(100,wPct).toFixed(1)}%;background:#3B82F6"></div>
          </div>
          <span class="pct" style="color:#3B82F6">${wPct.toFixed(0)}%</span>
        </div>
      </div>
    </div>`;

  document.getElementById("updated").textContent =
    "Actualizado " + new Date().toLocaleTimeString("es-ES", { hour:"2-digit", minute:"2-digit" });
}

function showWaiting() {
  document.getElementById("content").innerHTML =
    `<div class="state">Obteniendo datos…<small>El background está fetcheando la API de Claude.</small></div>`;
}

async function loadFromStorage() {
  const { liveUsage } = await chrome.storage.local.get("liveUsage");
  if (liveUsage) { render(liveUsage); return true; }
  return false;
}

async function init() {
  const hasCached = await loadFromStorage();
  chrome.runtime.sendMessage({ type: "REFRESH_USAGE" }, () => void chrome.runtime.lastError);
  if (!hasCached) showWaiting();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.liveUsage?.newValue) {
      render(changes.liveUsage.newValue);
    }
  });
}

init();
setInterval(() => {
  chrome.runtime.sendMessage({ type: "REFRESH_USAGE" }, () => void chrome.runtime.lastError);
}, 5 * 60_000);
