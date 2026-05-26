# Claude Token Tracker — Project Context

## What This Is

Browser extension (Chrome/Chromium MV3) that intercepts streaming API calls on **claude.ai** to measure real-time token consumption, then displays daily and weekly progress bars styled after Anthropic's visual language.

## Problem

Anthropic's console shows historical usage but there is no live per-session widget. Power users on the Pro plan hit invisible walls mid-conversation. This extension surfaces that information passively without any account credentials.

## Data Source Strategy

### Primary: Direct usage API (claude.ai session cookies)

`content.js` fetches `/api/organizations/{orgId}/usage` directly using the browser's existing claude.ai session cookies. The response contains:

```json
{
  "five_hour":  { "utilization": 0.84, "resets_at": "2026-05-26T15:00:00Z" },
  "seven_day":  { "utilization": 0.08, "resets_at": "2026-06-01T00:00:00Z" }
}
```

This powers the **inline widget** injected below the claude.ai input box. Refreshed every 5 minutes.

Org ID is resolved via (in priority order):
1. `lastActiveOrg` cookie (`document.cookie` regex match)
2. `window.__NEXT_DATA__.props.pageProps.bootstrapData.organization.uuid`
3. `/api/bootstrap` endpoint

### Secondary: SSE stream interception (token-level counts)

When claude.ai streams a response, it receives Server-Sent Events from Anthropic's backend. Each stream includes:

```
data: {"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":342,"output_tokens":0}}}
…
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":187}}
```

**How it works:**

1. `content.js` injects `page-inject.js` into the **page context** (not the content-script isolated world) via a `<script src>` tag at `document_start`.
2. `page-inject.js` wraps `window.fetch`, clones any matching SSE response, and parses `message_start` + `message_delta` events.
3. Token counts are sent back via `window.postMessage({ type: "CLAUDE_TOKEN_USAGE", ... }, origin)`.
4. `content.js` listens to `window.addEventListener("message")`, validates the source, and forwards via `chrome.runtime.sendMessage({ type: "UPDATE_USAGE", data })`.
5. `background.js` stores the counts in `chrome.storage.local` keyed by date.

This powers the **options page** stats (all-time total, days with data, export).

## Architecture

| Component | Role |
|---|---|
| `manifest.json` | MV3 manifest — permissions, content script, web_accessible_resources |
| `content.js` | Runs on claude.ai: injects page-inject.js, bridges postMessage→background, renders widget |
| `page-inject.js` | Page-context fetch wrapper — intercepts SSE streams, emits postMessage |
| `background.js` | Service worker — storage, aggregation, message handler, opens dashboard window |
| `dashboard.html/js` | Floating window opened on icon click — shows live 5h + weekly usage |
| `options.html/js/css` | Settings page — limit presets, data export/reset |

## Architecture Decisions

| Decision | Choice | Reason |
|---|---|---|
| Manifest version | V3 | Required for new Chrome extensions |
| Page injection | `web_accessible_resources` + `<script src>` | Only way to override `window.fetch` in page context under MV3 |
| Communication | `window.postMessage` → content script → `chrome.runtime.sendMessage` | Standard safe cross-context bridge |
| Storage | `chrome.storage.local` | Persists across browser restarts; sync not needed |
| Data retention | 30 rolling days | Enough for weekly views, avoids storage bloat |
| Week start | Monday | ISO standard |
| Token limits | User-configurable, sane defaults | No public API for plan limits |
| Dashboard | Floating popup window via `chrome.windows.create` | Better real estate than a browser tab; stays on top |

## URL Patterns Intercepted

`page-inject.js` watches fetch calls matching any of:
- `/completion`
- `/chat_conversations`
- `/append_message`

No host filter needed — the script only loads on `https://claude.ai/*` per `web_accessible_resources`.

## Message Types (content ↔ background)

| Message type | Direction | Payload |
|---|---|---|
| `UPDATE_USAGE` | content → background | `{ model, inputTokens, outputTokens }` |
| `GET_STATS` | options → background | — |
| `SET_LIMITS` | options → background | `{ daily, weekly }` |
| `RESET_DATA` | options → background | — |
| `EXPORT_DATA` | options → background | — |
| `STORE_USAGE` | content → background | raw API usage object |
| `REFRESH_USAGE` | dashboard → background | — (triggers fetchLiveUsage) |
| `RELOAD` | dashboard → background | — (triggers chrome.runtime.reload) |

## Known Limitations

- **Only works on claude.ai** — does not track API usage made from third-party apps
- **Session-based** — if the browser closes mid-stream, partial counts may be missed
- **Model attribution** — model comes from `message_start` event
- **No rate-limit info** — actual plan limits are not exposed by claude.ai; defaults are estimates
- **Free-tier users** — Anthropic may use message counts, not token counts; progress bar still shows tokens
