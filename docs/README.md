# Claude Token Tracker

Chrome extension that displays real-time Claude usage limits directly on claude.ai — an inline widget below the chat box, a floating dashboard popup when you click the extension icon, and a full-page **Metric Dashboard** for `ccusage`-based Claude Code analytics.

## What it shows

### claude.ai popup (live limits)

| Field | API source | Description |
|---|---|---|
| **5h limit** (orange) | `five_hour.utilization` | % of the 5-hour session limit |
| **Weekly** (blue) | `seven_day.utilization` | % of the weekly limit (all models) |
| Reset time | `five_hour.resets_at` / `seven_day.resets_at` | Absolute day + time: "Wed 04:40" |

Data comes from the real API: `/api/organizations/{orgId}/usage`. Org ID is read from the `lastActiveOrg` cookie.

### Metric Dashboard (Claude Code analytics)

Opened from the **Dashboard** button in the popup header. Renders a static snapshot of `ccusage` output: tokens/cost per day, model breakdown, agent breakdown, weekly aggregates, top projects, top sessions. Filters: range (7d/30d/custom), agent, project. All assets self-hosted — no CDN, no external font calls. Chart.js bundled under `lib/`.

Data is read from `usage-data.js` (a static `window.__USAGE__ = {...}` blob produced by `ccusage` and pasted in). To refresh: re-run your `ccusage` export and replace `usage-data.js`.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `claude-token-tracker` folder

> Icons are pre-generated in `icons/`. To regenerate them run `node make-icons.js` (Node.js, no dependencies).

## Usage

- **Widget** — go to **claude.ai**, the bar appears automatically below the message input
- **Live popup** — click the extension icon in the Chrome toolbar → floating window with 5h + weekly limits
- **Metric Dashboard** — click the `Dashboard` button inside the popup header → full-page Claude Code usage charts (opens in a new tab)

## Auto-update

The extension checks for updates every minute by comparing its local `manifest.json` version against the one on GitHub. If a newer version is found:

- The toolbar icon shows an **↑** badge
- The dashboard shows an orange banner with a **Reload** button

To update: `git pull` in the project folder, then click **Reload** (or go to `chrome://extensions` and reload manually).

## Compatibility

| Browser | Status |
|---|---|
| Chrome 109+ | ✅ |
| Edge 109+ | ✅ (Chromium) |
| Firefox | ❌ Different MV3 implementation |

## Architecture

```
page-inject.js     Runs in page context — wraps window.fetch, parses SSE streams.
       ↓ postMessage
content.js         Receives token counts, forwards to background.
                   Injects the inline widget. Calls /api/.../usage every 5 min.
       ↓ chrome.runtime.sendMessage
background.js      Service worker. Opens dashboard window on icon click.
                   Fetches live usage via Chrome cookie store (REFRESH_USAGE).
                   Checks GitHub for updates every 1 min.
       ↓ chrome.storage.local
dashboard.js       Reads liveUsage from storage. Reacts instantly via onChanged.
                   Requests refresh every 60 s as fallback.
```

## File map

```
claude-token-tracker/
├── manifest.json         MV3 manifest
├── background.js         Service worker
├── content.js            Widget + postMessage bridge + API polling
├── page-inject.js        Fetch interceptor (page context)
├── dashboard.html/js     Floating live-limits popup (claude.ai)
├── dashboard-open.js     Opens usage.html in a new tab when Dashboard button is clicked
├── usage.html            Metric Dashboard page (Claude Code analytics)
├── usage-app.js          Metric Dashboard render logic (Chart.js)
├── usage-data.js         Static `window.__USAGE__` data (regenerate from ccusage)
├── lib/                  Self-hosted Chart.js + datalabels plugin (MV3 CSP-safe)
├── options.html/css/js   Settings page
├── make-icons.js         PNG icon generator (Node.js, no deps)
├── icons/                icon16/48/128.png
└── docs/                 README, ARCHITECTURE, CONTEXT
```

## License

MIT
