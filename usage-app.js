const D = window.__USAGE__;
if (!D || !D.generatedAt || !D.daily || D.daily.length === 0) {
  document.querySelector('main').innerHTML = `
    <div style="text-align:center;padding:80px 20px;color:var(--muted)">
      <h2 style="font-family:var(--serif);font-size:22px;color:var(--text);margin-bottom:14px;font-weight:500">No data yet</h2>
      <p style="font-size:14px;line-height:1.6;max-width:520px;margin:0 auto 24px">
        This dashboard reads from <code style="background:var(--panel);padding:2px 8px;border-radius:6px">~/.claude/projects/</code> via
        <a href="https://github.com/ryoppippi/ccusage" target="_blank" style="color:var(--accent)">ccusage</a>.
        Chrome extensions can't read local files, so the data is generated offline by a build script.
      </p>
      <p style="font-size:13px;color:var(--muted-2);max-width:520px;margin:0 auto">
        Setup: clone <a href="https://github.com/mmesonero/claude-code-usage" target="_blank" style="color:var(--accent)">claude-code-usage</a>,
        run <code style="background:var(--panel);padding:2px 8px;border-radius:6px">npm start</code>,
        it writes <code style="background:var(--panel);padding:2px 8px;border-radius:6px">usage-data.js</code> into this extension's folder.
        Reload the extension to see your data.
      </p>
    </div>`;
  document.querySelector('.filter').style.display = 'none';
  throw new Error('No usage data');
}
const fmtInt = n => new Intl.NumberFormat('en-US').format(Math.round(n || 0));
const fmtTok = n => n >= 1e9 ? (n/1e9).toFixed(2)+'B' : n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n||0);
const fmtUsd = n => '$' + (n || 0).toFixed(2);

document.getElementById('gen').textContent = 'Generated ' + new Date(D.generatedAt).toLocaleString();

const agents = new Set(['all']);
for (const r of D.daily) for (const a of (r.metadata?.agents || [r.agent])) agents.add(a);
const selAgent = document.getElementById('agent');
for (const a of agents) if (a !== 'all') selAgent.add(new Option(a, a));

const selProject = document.getElementById('project');
const shortProj = p => {
  if (!p) return '—';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/');
};
for (const p of (D.projects || [])) {
  if (p.project === '(unknown)') continue;
  selProject.add(new Option(`${shortProj(p.project)} · $${(p.totalCost||0).toFixed(0)}`, p.project));
}

const selRange = document.getElementById('range');
const inpFrom = document.getElementById('from');
const inpTo = document.getElementById('to');

function isoToday() { return new Date().toISOString().slice(0,10); }
function daysAgoISO(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0,10);
}
function getDateRange() {
  const v = selRange.value;
  if (v === 'all') return [null, null];
  if (v === 'custom') return [inpFrom.value || null, inpTo.value || null];
  return [daysAgoISO(parseInt(v, 10) - 1), isoToday()];
}

function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const ys = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const w = Math.ceil((((tmp - ys) / 86400000) + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}

function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  if (from && dateStr < from) return false;
  if (to && dateStr > to) return false;
  return true;
}

const palette = ['#d97757','#c89f7c','#6ee7b7','#e0a87b','#a78bfa','#fbbf24','#fb7185','#60a5fa','#22d3ee','#84cc16'];
const gridColor = 'rgba(250, 249, 245, 0.06)';
Chart.defaults.color = '#b9b9b3';
Chart.defaults.borderColor = gridColor;
Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
Chart.defaults.font.size = 12;
Chart.register(ChartDataLabels);
Chart.defaults.plugins.datalabels = { display: false };

const donutLabels = () => ({
  color: '#ffffff',
  textStrokeColor: 'rgba(0,0,0,0.85)',
  textStrokeWidth: 3,
  font: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif', weight: 700, size: 11 },
  formatter: (v, ctx) => {
    const data = ctx.chart.data.datasets[0].data;
    const total = data.reduce((a,b) => a + b, 0);
    const pct = total ? (v / total) * 100 : 0;
    if (pct < 6) return '';
    const label = ctx.chart.data.labels[ctx.dataIndex];
    return `${label}\n${pct.toFixed(0)}%`;
  },
  textAlign: 'center',
  anchor: 'center',
  align: 'center',
  display: 'auto',
});

let charts = {};
function destroyAll() { for (const k in charts) { charts[k].destroy(); } charts = {}; }

function aggByAgent(rows, agent) {
  if (agent === 'all') {
    const byPeriod = new Map();
    for (const r of rows) {
      const p = r.period;
      if (!byPeriod.has(p)) byPeriod.set(p, { period: p, inputTokens:0, outputTokens:0, cacheCreationTokens:0, cacheReadTokens:0, totalTokens:0, totalCost:0, modelBreakdowns: [] });
      const acc = byPeriod.get(p);
      acc.inputTokens += r.inputTokens || 0;
      acc.outputTokens += r.outputTokens || 0;
      acc.cacheCreationTokens += r.cacheCreationTokens || 0;
      acc.cacheReadTokens += r.cacheReadTokens || 0;
      acc.totalTokens += r.totalTokens || 0;
      acc.totalCost += r.totalCost || 0;
      for (const m of (r.modelBreakdowns || [])) acc.modelBreakdowns.push(m);
    }
    return [...byPeriod.values()].sort((a,b) => a.period.localeCompare(b.period));
  }
  return rows.filter(r => r.agent === agent || (r.metadata?.agents || []).includes(agent))
             .sort((a,b) => a.period.localeCompare(b.period));
}

function aggFromSessions(sessions, periodFn) {
  const byPeriod = new Map();
  for (const s of sessions) {
    const day = s.metadata?.lastActivity;
    if (!day) continue;
    const p = periodFn(day);
    if (!byPeriod.has(p)) byPeriod.set(p, { period: p, inputTokens:0, outputTokens:0, cacheCreationTokens:0, cacheReadTokens:0, totalTokens:0, totalCost:0, modelBreakdowns: [] });
    const acc = byPeriod.get(p);
    acc.inputTokens += s.inputTokens || 0;
    acc.outputTokens += s.outputTokens || 0;
    acc.cacheCreationTokens += s.cacheCreationTokens || 0;
    acc.cacheReadTokens += s.cacheReadTokens || 0;
    acc.totalTokens += s.totalTokens || 0;
    acc.totalCost += s.totalCost || 0;
    for (const m of (s.modelBreakdowns || [])) acc.modelBreakdowns.push(m);
  }
  return [...byPeriod.values()].sort((a,b) => a.period.localeCompare(b.period));
}

function render() {
  destroyAll();
  const agent = selAgent.value;
  const project = selProject.value;
  const [from, to] = getDateRange();

  const sessionsAll = (D.sessions || []).filter(s =>
    (agent === 'all' || s.agent === agent) &&
    (project === 'all' || s.projectPath === project) &&
    inRange(s.metadata?.lastActivity, from, to)
  );

  const projectFilterActive = project !== 'all';
  let daily;
  if (projectFilterActive) {
    daily = aggFromSessions(sessionsAll, d => d);
  } else {
    daily = aggByAgent(D.daily, agent).filter(r => inRange(r.period, from, to));
  }
  const weekly = (function buildWeekly() {
    const m = new Map();
    for (const r of daily) {
      const w = isoWeek(r.period);
      if (!m.has(w)) m.set(w, { period: w, totalTokens: 0, totalCost: 0 });
      const a = m.get(w);
      a.totalTokens += r.totalTokens || 0;
      a.totalCost += r.totalCost || 0;
    }
    return [...m.values()].sort((a, b) => a.period.localeCompare(b.period));
  })();

  const totCost = daily.reduce((s,r) => s + (r.totalCost||0), 0);
  const totTok = daily.reduce((s,r) => s + (r.totalTokens||0), 0);
  const totIn = daily.reduce((s,r) => s + (r.inputTokens||0), 0);
  const totOut = daily.reduce((s,r) => s + (r.outputTokens||0), 0);
  const totCacheR = daily.reduce((s,r) => s + (r.cacheReadTokens||0), 0);
  const totCacheC = daily.reduce((s,r) => s + (r.cacheCreationTokens||0), 0);
  const days = daily.length;
  const avgDay = days ? totCost / days : 0;
  const last7 = daily.slice(-7).reduce((s,r) => s + (r.totalCost||0), 0);
  const prev7 = daily.slice(-14, -7).reduce((s,r) => s + (r.totalCost||0), 0);
  const wow = prev7 ? ((last7 - prev7) / prev7 * 100) : 0;

  const cards = [
    { label: 'Total cost', value: fmtUsd(totCost), sub: `${days} days · avg ${fmtUsd(avgDay)}/day` },
    { label: 'Total tokens', value: fmtTok(totTok), sub: `in ${fmtTok(totIn)} · out ${fmtTok(totOut)}` },
    { label: 'Cache read', value: fmtTok(totCacheR), sub: `creation ${fmtTok(totCacheC)}` },
    { label: 'Last 7 days', value: fmtUsd(last7), sub: (prev7 ? `<span class="${wow >= 0 ? 'up' : 'down'}">${wow >= 0 ? '▲' : '▼'} ${Math.abs(wow).toFixed(0)}%</span> vs prev 7` : 'no prev period') },
  ];
  document.getElementById('cards').innerHTML = cards.map(c =>
    `<div class="card"><div class="label">${c.label}</div><div class="value">${c.value}</div><div class="sub">${c.sub}</div></div>`
  ).join('');

  const labels = daily.map(r => r.period);

  charts.tokens = new Chart(document.getElementById('cTokens'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Input',          data: daily.map(r => r.inputTokens||0),          backgroundColor: palette[2], stack: 't' },
        { label: 'Output',         data: daily.map(r => r.outputTokens||0),         backgroundColor: palette[0], stack: 't' },
        { label: 'Cache create',   data: daily.map(r => r.cacheCreationTokens||0),  backgroundColor: palette[3], stack: 't' },
        { label: 'Cache read',     data: daily.map(r => r.cacheReadTokens||0),      backgroundColor: palette[1], stack: 't' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtInt(c.parsed.y)}` } } },
      scales: { x: { stacked: true, grid: { color: gridColor } }, y: { stacked: true, grid: { color: gridColor }, ticks: { callback: v => fmtTok(v) } } },
    },
  });

  charts.cost = new Chart(document.getElementById('cCost'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Cost', data: daily.map(r => r.totalCost||0), borderColor: palette[0], backgroundColor: palette[0]+'33', fill: true, tension: 0.25, pointRadius: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtUsd(c.parsed.y) } } },
      scales: { x: { grid: { color: gridColor } }, y: { grid: { color: gridColor }, ticks: { callback: v => '$'+v.toFixed(2) } } },
    },
  });

  const modelCost = new Map();
  for (const r of daily) for (const m of (r.modelBreakdowns || [])) modelCost.set(m.modelName, (modelCost.get(m.modelName)||0) + (m.cost||0));
  const mEntries = [...modelCost.entries()].sort((a,b) => b[1] - a[1]);
  charts.models = new Chart(document.getElementById('cModels'), {
    type: 'doughnut',
    data: { labels: mEntries.map(e => e[0]), datasets: [{ data: mEntries.map(e => e[1]), backgroundColor: palette, borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: c => `${c.label}: ${fmtUsd(c.parsed)}` } }, datalabels: donutLabels() } },
  });

  const agentTok = new Map();
  for (const r of D.daily) {
    const ags = r.metadata?.agents || [r.agent];
    for (const a of ags) agentTok.set(a, (agentTok.get(a)||0) + (r.totalTokens||0));
  }
  const aEntries = [...agentTok.entries()].sort((a,b) => b[1] - a[1]);
  charts.agents = new Chart(document.getElementById('cAgents'), {
    type: 'doughnut',
    data: { labels: aEntries.map(e => e[0]), datasets: [{ data: aEntries.map(e => e[1]), backgroundColor: palette, borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: c => `${c.label}: ${fmtTok(c.parsed)}` } }, datalabels: donutLabels() } },
  });

  const wkLabels = weekly.map(r => r.period);
  charts.weekly = new Chart(document.getElementById('cWeekly'), {
    type: 'bar',
    data: { labels: wkLabels, datasets: [{ label: 'Tokens', data: weekly.map(r => r.totalTokens||0), backgroundColor: palette[1] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtInt(c.parsed.y) } } }, scales: { x: { grid: { color: gridColor } }, y: { grid: { color: gridColor }, ticks: { callback: v => fmtTok(v) } } } },
  });
  charts.weeklyCost = new Chart(document.getElementById('cWeeklyCost'), {
    type: 'bar',
    data: { labels: wkLabels, datasets: [{ label: 'Cost', data: weekly.map(r => r.totalCost||0), backgroundColor: palette[0] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtUsd(c.parsed.y) } } }, scales: { x: { grid: { color: gridColor } }, y: { grid: { color: gridColor }, ticks: { callback: v => '$'+v.toFixed(0) } } } },
  });

  const shortProjHtml = p => p
    ? p.split(/[\\/]/).filter(Boolean).slice(-2).join('/')
    : '<span style="color:var(--muted-2)">—</span>';

  const topSessions = [...sessionsAll]
    .sort((a, b) => (b.totalCost || 0) - (a.totalCost || 0))
    .slice(0, 20);
  document.getElementById('tblSessions').innerHTML = topSessions.map(s => `
    <tr>
      <td>${s.metadata?.lastActivity || '—'}</td>
      <td><span class="pill ${s.agent}">${s.agent}</span></td>
      <td title="${s.projectPath || ''}">${shortProjHtml(s.projectPath)}</td>
      <td>${(s.modelsUsed || []).join(', ')}</td>
      <td class="num">${fmtTok(s.totalTokens)}</td>
      <td class="num">${fmtUsd(s.totalCost)}</td>
    </tr>`).join('');

  const projMap = new Map();
  for (const s of sessionsAll) {
    const key = s.projectPath || '(unknown)';
    const acc = projMap.get(key) || { project: key, totalCost: 0, totalTokens: 0, sessions: 0, lastActivity: '', agents: new Set(), models: new Set() };
    acc.totalCost += s.totalCost || 0;
    acc.totalTokens += s.totalTokens || 0;
    acc.sessions += 1;
    const la = s.metadata?.lastActivity || '';
    if (la > acc.lastActivity) acc.lastActivity = la;
    if (s.agent) acc.agents.add(s.agent);
    for (const m of (s.modelsUsed || [])) acc.models.add(m);
    projMap.set(key, acc);
  }
  const projects = [...projMap.values()]
    .map(p => ({ ...p, agents: [...p.agents], models: [...p.models] }))
    .sort((a, b) => b.totalCost - a.totalCost);
  const topN = projects.slice(0, 15);

  charts.projects = new Chart(document.getElementById('cProjects'), {
    type: 'bar',
    data: {
      labels: topN.map(p => p.project.split(/[\\/]/).filter(Boolean).slice(-2).join('/')),
      datasets: [{ label: 'Cost', data: topN.map(p => p.totalCost || 0), backgroundColor: palette[0] }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtUsd(c.parsed.x), title: c => topN[c[0].dataIndex].project } } },
      scales: { x: { grid: { color: gridColor }, ticks: { callback: v => '$' + v.toFixed(0) } }, y: { grid: { display: false } } },
    },
  });

  document.getElementById('tblProjects').innerHTML = projects.slice(0, 30).map(p => `
    <tr>
      <td title="${p.project}">${shortProjHtml(p.project)}</td>
      <td>${p.lastActivity || '—'}</td>
      <td>${p.agents.map(a => `<span class="pill ${a}" style="margin-right:4px">${a}</span>`).join('')}</td>
      <td class="num">${p.sessions}</td>
      <td class="num">${fmtTok(p.totalTokens)}</td>
      <td class="num">${fmtUsd(p.totalCost)}</td>
    </tr>`).join('');
}

selAgent.addEventListener('change', render);
selProject.addEventListener('change', render);
selRange.addEventListener('change', () => {
  const isCustom = selRange.value === 'custom';
  inpFrom.hidden = !isCustom;
  inpTo.hidden = !isCustom;
  if (isCustom && !inpFrom.value) {
    inpFrom.value = daysAgoISO(30);
    inpTo.value = isoToday();
  }
  render();
});
inpFrom.addEventListener('change', render);
inpTo.addEventListener('change', render);
document.getElementById('refresh').addEventListener('click', () => {
  alert('Run "npm start" (or "npm run build") in claude-code-usage to refresh data.');
});
render();
