# Architecture

## File Map

```
claude-token-tracker/
├── manifest.json          MV3 manifest — permissions, content scripts, action (v1.3.2)
├── background.js          Service worker — opens dashboard window, fetches API, message bus, update check
├── content.js             Runs on claude.ai — injects widget, calls API, bridges storage
├── page-inject.js         Runs in page context — wraps window.fetch (passive listener)
├── dashboard.html         Floating popup window opened on icon click — dark UI, two cards
├── dashboard.js           Popup logic — external file (MV3 CSP blocks inline scripts)
├── dashboard-open.js      Click handler for the "Dashboard" button → tabs.create(usage.html)
├── usage.html             Metric Dashboard — Claude Code analytics (ccusage snapshot)
├── usage-app.js           Metric Dashboard render code (filters, charts, tables)
├── usage-data.js          Static window.__USAGE__ blob — gitignored, regenerate via ccusage
├── lib/
│   ├── chart.umd.min.js              Chart.js v4.4.6 (self-hosted, MV3 CSP-safe)
│   └── chartjs-plugin-datalabels.js  v2.2.0 (self-hosted)
├── options.html/css/js    Settings page — limit presets, data export/reset
├── make-icons.js          Node.js — generates PNGs without external dependencies
├── icons/
│   ├── icon16.png         16×16 toolbar icon
│   ├── icon48.png         48×48 (dashboard header + favicon)
│   └── icon128.png        128×128 Chrome Web Store
└── docs/
    ├── CONTEXT.md         Project decisions and context
    ├── ARCHITECTURE.md    This file
    └── README.md          Setup and installation
```

## Data Flow

```
┌─────────────────────────────────────────────────────┐
│  claude.ai tab                                      │
│                                                     │
│  ┌─────────────────┐                               │
│  │  page-inject.js │  wraps window.fetch (passive) │
│  └─────────────────┘                               │
│           │ postMessage(CLAUDE_TOKEN_USAGE)         │
│  ┌────────▼────────┐                               │
│  │  content.js     │  fetch /api/organizations/    │
│  │  (widget)       │        {orgId}/usage           │
│  └────────┬────────┘                               │
└───────────┼─────────────────────────────────────────┘
            │ chrome.runtime.sendMessage('STORE_USAGE')
            ▼
  ┌─────────────────┐
  │  background.js  │──► chrome.storage.local { liveUsage }
  │  service worker │◄── chrome.cookies (lastActiveOrg)
  └────────┬────────┘
           │ fetch https://claude.ai/api/.../usage
           │ (REFRESH_USAGE — from dashboard or timer)
           ▼
  ┌─────────────────┐
  │  dashboard.js   │  chrome.storage.onChanged → refresh localStats + render()
  │  (popup window) │  setInterval REFRESH_USAGE every 60 s
  └─────────────────┘
```

## Storage Schema

```javascript
// chrome.storage.local keys:
{
  liveUsage: {
    five_hour: {
      utilization: 25.3,          // usage % (0-100)
      resets_at: "2026-05-26T23:00:00Z"
    },
    seven_day: {
      utilization: 29.1,
      resets_at: "2026-06-02T13:00:00Z"
    }
  },
  liveUsageAt: 1748210400000,     // unix ms of last fetch

  // Local token counting history (from SSE interception):
  usage: {
    "2026-05-26": {
      input: 342100,
      output: 87400,
      models: {
        "claude-sonnet-4-6": { input: 280000, output: 70000 }
      }
    }
    // up to 30 days rolling
  },
  limits: { daily: 1000000, weekly: 7000000 },
  lastUpdated: 1748210400000,

  // Update check:
  updateAvailable: false,
  remoteVersion: "1.3.2"
}

// chrome.storage.session keys:
{
  dashWindowId: 12345   // ID of open dashboard popup window (survives SW idle restarts)
}
```

## Message Protocol

| Sender | Type | Payload | Response |
|---|---|---|---|
| content.js → background | `STORE_USAGE` | raw `liveUsage` API object | `{ok: true}` |
| dashboard.js → background | `REFRESH_USAGE` | — | `{ok: true}` (fire & forget) |
| content.js → background | `UPDATE_USAGE` | `{model, inputTokens, outputTokens}` | `{ok: true}` |
| any → background | `GET_STATS` | — | `{today, week, limits, lastUpdated, history}` |
| options → background | `SET_LIMITS` | `{daily, weekly}` | `{ok: true}` |
| options → background | `EXPORT_DATA` | — | full usage object |
| options → background | `RESET_DATA` | — | `{ok: true}` |
| dashboard → background | `RELOAD` | — | `{ok: true}` then `chrome.runtime.reload()` |

## Design Tokens

```css
/* Background / surface */
--bg:       #0F0E0D   /* near black */
--surface:  rgba(255,253,247,.04)
--border:   rgba(255,253,247,.07)

/* Text */
--text:     #FFFDF7
--muted:    rgba(255,253,247,.35)
--dim:      rgba(255,253,247,.18)

/* Accent */
--orange:        #D4670F   /* 5h session limit */
--orange-warn:   #F59E0B   /* ≥70% */
--orange-danger: #EF4444   /* ≥90% */
--blue:          #3B82F6   /* weekly limit */
--green:         #4ADE80   /* LIVE badge active */
```

## Technical Decisions

**No default popup** — `chrome.action.onClicked` opens `dashboard.html` as a centered floating window (`chrome.windows.create({ type: "popup" })`). More space, no MV3 popup height limits. Window ID persisted in `chrome.storage.session` so duplicate windows are prevented across service worker restarts.

**External JS required** — MV3 Content Security Policy blocks inline `<script>` in extension pages. All dashboard/options logic lives in external `.js` files.

**Background fetch** — the service worker can call `fetch` with `credentials: "include"` to any URL declared in `host_permissions`. It uses Chrome's cookie store — no user credentials needed.

**Storage as reactive channel** — instead of `sendMessage`/`sendResponse` (unreliable when the service worker is sleeping), data is written to `chrome.storage.local` and the dashboard listens via `onChanged`. The `onChanged` handler also refreshes `localStats` before re-rendering to avoid stale token counts in expanded cards.

**Update check** — every 12 hours via `chrome.alarms` (not `setInterval` — alarms survive service worker idle restarts). The alarm is created with `chrome.alarms.get` guard to prevent duplicates. Compares versions numerically (not string equality) so older local versions correctly trigger the update banner.

**web_accessible_resources** — `usage.html`, `usage-app.js`, `usage-data.js` and `lib/` are restricted to `chrome-extension://*/*` matches only. External pages cannot fetch these resources.

**Message listener guard** — `content.js` sets `window.__cttListenerAttached` before adding the `message` event listener, preventing duplicate listeners on SPA re-injections.

## Metric Dashboard (Claude Code usage)

Separate full-page view (`usage.html`) launched from a small **Dashboard** button anchored to the right of the popup header. Independent from the live-limits flow — no API, no service worker round-trip.

**Flow**

```
dashboard.html (popup)
   └── Dashboard button
         └── dashboard-open.js → chrome.tabs.create({ url: chrome.runtime.getURL('usage.html') })
               └── usage.html
                     ├── lib/chart.umd.min.js          (self-hosted)
                     ├── lib/chartjs-plugin-datalabels.js
                     ├── usage-data.js                 → sets window.__USAGE__
                     └── usage-app.js                  → reads __USAGE__, renders charts/tables
```

**Data source** — `usage-data.js` is generated by `claude-code-usage/build.mjs` which calls `ccusage@20.0.6`, aggregates daily/weekly/monthly/session data, resolves local project paths, and writes the file here. The `claude-code-usage` repo is private (contains real session paths and costs). Run `npm start` there to refresh.

**View structure**

- Row 1: 4 summary cards — Total tokens (global percentile), Total cost (avg/day), Cache efficiency, Cache reuse rate
- Row 2: 3-column charts — Tokens per day (line + 7d rolling avg), Model breakdown doughnut (by tokens), Top projects by cost (horizontal bar + expandable table)

**Why self-hosted Chart.js** — MV3 default CSP is `script-src 'self'; object-src 'self'`. Remote scripts (CDN) and inline `<script>` blocks are both blocked. Everything must be a same-origin file.

**XSS protection** — all user-supplied strings (project paths, agent names) are escaped with `esc()` before insertion into `innerHTML`.

**Projects filter** — projects with total cost < $5 are excluded from chart, table, and project selector to reduce noise.
