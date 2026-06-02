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
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
  if ((p.totalCost || 0) < 5) continue;
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

  // ── Model aggregates ───────────────────────────────────────────────────────
  const modelCost = new Map();
  const modelTok  = new Map();
  for (const r of daily) for (const m of (r.modelBreakdowns || [])) {
    modelCost.set(m.modelName, (modelCost.get(m.modelName)||0) + (m.cost||0));
    modelTok.set(m.modelName,  (modelTok.get(m.modelName)||0)  + (m.inputTokens||0) + (m.outputTokens||0) + (m.cacheCreationTokens||0) + (m.cacheReadTokens||0));
  }
  const mEntries = [...modelTok.entries()].sort((a,b) => b[1] - a[1]);

  // Cache efficiency (needed early for cards row)
  const cacheInputSide = totCacheR + totCacheC + totIn;
  const cacheEff = cacheInputSide > 0 ? (totCacheR / cacheInputSide) * 100 : 0;
  const cacheEffColor = cacheEff >= 70 ? 'good' : cacheEff >= 40 ? 'warn' : 'bad';

  // Cost/1K output — computed early for cards row
  const costPer1kOutEarly = totOut > 0 ? (totCost / totOut) * 1000 : 0;
  const API_OUT_PER_MTOK_EARLY = { 'claude-opus-4-8':25,'claude-opus-4-7':25,'claude-opus-4-6':25,'claude-sonnet-4-6':15,'claude-sonnet-4-5':15,'claude-haiku-4-5-20251001':5,'claude-haiku-4-5':5 };
  let apiOutCostEarly = 0;
  for (const r of daily) for (const m of (r.modelBreakdowns || [])) {
    apiOutCostEarly += (m.outputTokens||0) / 1e6 * (API_OUT_PER_MTOK_EARLY[m.modelName] ?? 15);
  }
  const apiOutPer1kEarly = totOut > 0 ? (apiOutCostEarly / totOut) * 1000 : 0;
  const overheadMultEarly = apiOutPer1kEarly > 0 ? costPer1kOutEarly / apiOutPer1kEarly : 1;
  const costEffColorEarly = overheadMultEarly < 5 ? 'good' : overheadMultEarly < 10 ? 'warn' : 'bad';

  const cards = [
    { label: 'Total tokens',     value: fmtTok(totTok),   sub: (() => { const r = avgDay / 6; const p = r > 67 ? 0.1 : r > 33 ? 0.5 : r > 10 ? 1 : r > 5 ? 3 : r > 2 ? 10 : 25; return `<span style="color:var(--good)">${p}%</span> globally`; })() },
    { label: 'Total cost',       value: fmtUsd(totCost),  sub: `Avg ${fmtUsd(avgDay)}/day` },
    { label: 'Cache efficiency', value: `<span class="metric-${cacheEffColor}">${cacheEff.toFixed(0)}%</span>`, sub: `≥70% <span style="color:var(--good)">●</span> ≥40% <span style="color:var(--warn)">●</span> &lt;40% <span style="color:var(--bad)">●</span>` },
    (() => { const r = totCacheC > 0 ? totCacheR / totCacheC : 0; const color = r >= 10 ? 'good' : r >= 3 ? 'warn' : 'bad'; return { label: 'Cache reuse rate', value: `<span class="metric-${color}">${r.toFixed(0)}×</span>`, sub: `reads / creates &nbsp;·&nbsp; ≥10× <span style="color:var(--good)">●</span> ≥3× <span style="color:var(--warn)">●</span>` }; })(),
  ];
  document.getElementById('cards').innerHTML = cards.map(c =>
    `<div class="card"><div class="label">${c.label}</div><div class="value">${c.value}</div><div class="sub">${c.sub}</div></div>`
  ).join('');


  const labels = daily.map(r => r.period);

  const rollingTok = daily.map((_, i) => {
    const slice = daily.slice(Math.max(0, i - 6), i + 1);
    const active = slice.filter(r => r.totalTokens > 0).length || 1;
    return slice.reduce((s, r) => s + (r.totalTokens || 0), 0) / active;
  });
  charts.tokens = new Chart(document.getElementById('cTokens'), {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Total tokens', data: daily.map(r => r.totalTokens||0), borderColor: palette[1], backgroundColor: palette[1]+'33', fill: true, tension: 0.25, pointRadius: 2 },
      { label: '7d rolling avg', data: rollingTok, borderColor: '#84cc16', backgroundColor: 'transparent', fill: false, tension: 0.4, pointRadius: 0, borderDash: [5, 3], borderWidth: 1.5 },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'bottom', labels: { usePointStyle: true, pointStyle: 'line' } }, tooltip: { callbacks: { label: c => c.dataset.label + ': ' + fmtTok(c.parsed.y) } } },
      scales: { x: { grid: { color: gridColor } }, y: { grid: { color: gridColor }, ticks: { callback: v => fmtTok(v) } } },
    },
  });


  // Nested doughnut: outer = brand, inner = individual models
  const modelBrand = n => n.startsWith('claude') ? 'Claude' : n.startsWith('gpt') || n.startsWith('o1') || n.startsWith('o3') ? 'OpenAI' : 'Other';
  const BRAND_COLOR = { Claude: '#d97757', OpenAI: '#6ee7b7', Other: '#94a3b8' };
  const MODEL_SHADES = {
    Claude: ['#d97757','#b8472e','#e8955a','#f0b080','#a83820','#f5c89a'],
    OpenAI: ['#6ee7b7','#34d399','#10b981','#a7f3d0','#059669'],
    Other:  ['#94a3b8','#64748b'],
  };
  const brandOrder = [];
  const brandCostMap = new Map();
  for (const [m, cost] of mEntries) {
    const b = modelBrand(m);
    if (!brandCostMap.has(b)) { brandOrder.push(b); brandCostMap.set(b, 0); }
    brandCostMap.set(b, brandCostMap.get(b) + cost);
  }
  const outerLabels = brandOrder;
  const outerData   = brandOrder.map(b => brandCostMap.get(b));
  const outerColors = brandOrder.map(b => BRAND_COLOR[b] || BRAND_COLOR.Other);

  const innerLabels = [], innerData = [], innerColors = [];
  for (const brand of brandOrder) {
    const models = mEntries.filter(([m]) => modelBrand(m) === brand);
    const shades  = MODEL_SHADES[brand] || MODEL_SHADES.Other;
    models.forEach(([m, cost], i) => {
      innerLabels.push(m);
      innerData.push(cost);
      innerColors.push(shades[i % shades.length]);
    });
  }
  const shortModel = n => n.replace(/^claude-/, '').replace(/-(\d{4,}).*$/, '');

  charts.models = new Chart(document.getElementById('cModels'), {
    type: 'doughnut',
    data: {
      labels: mEntries.map(e => shortModel(e[0])),
      datasets: [{
        data: mEntries.map(e => e[1]),
        backgroundColor: (() => {
          const counts = {};
          return mEntries.map(([m]) => {
            const b = modelBrand(m);
            counts[b] = (counts[b] || 0);
            const c = (MODEL_SHADES[b] || MODEL_SHADES.Other)[counts[b] % (MODEL_SHADES[b] || MODEL_SHADES.Other).length];
            counts[b]++;
            return c;
          });
        })(),
        borderWidth: 2, borderColor: '#262624',
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: items => shortModel(items[0].label), label: c => ' ' + fmtTok(c.parsed) } },
        datalabels: donutLabels(),
      },
    },
  });


  const shortProjHtml = p => p
    ? esc(p.split(/[\\/]/).filter(Boolean).slice(-2).join('/'))
    : '<span style="color:var(--muted-2)">—</span>';


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
  const topN = projects.filter(p => p.totalCost >= 5).slice(0, 15);

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

  document.getElementById('tblProjects').innerHTML = projects.filter(p => p.totalCost >= 5).slice(0, 30).map(p => `
    <tr>
      <td title="${esc(p.project)}">${shortProjHtml(p.project)}</td>
      <td>${esc(p.lastActivity || '—')}</td>
      <td>${p.agents.map(a => `<span class="pill ${esc(a)}" style="margin-right:4px">${esc(a)}</span>`).join('')}</td>
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

document.getElementById('toggleProjects').addEventListener('click', function () {
  const detail = document.getElementById('projectsDetail');
  const open = detail.style.display !== 'none';
  detail.style.display = open ? 'none' : 'block';
  this.textContent = open ? '▼ All projects' : '▲ Hide';
});
render();
