# Claude Token Tracker — Project Context

## What This Is

Browser extension (Chrome/Chromium MV3) that intercepts streaming API calls on **claude.ai** to measure real-time token consumption, then displays daily and weekly progress bars styled after Anthropic's visual language.

## Problem

Anthropic's console shows historical usage but there is no live per-session widget. Power users on the Pro plan hit invisible walls mid-conversation. This extension surfaces that information passively without any account credentials.

## Data Source Strategy

### Primary: SSE interception on claude.ai (no auth needed)

When claude.ai streams a response, it receives Server-Sent Events from Anthropic's backend. Each stream includes:

```
data: {"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":342,"output_tokens":0}}}
…
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":187}}
```

The extension injects a tiny script into the **page context** (not content-script context) to wrap `window.fetch`, clone streamed responses, and parse these events without touching the real response the page sees.

### Secondary (future): Anthropic Console API

If Anthropic exposes a billing/usage REST endpoint it could be polled with a user-supplied API key. Not implemented in v1.

## Architecture Decisions

| Decision | Choice | Reason |
|---|---|---|
| Manifest version | V3 | Required for new Chrome extensions |
| Page injection | `web_accessible_resources` script | Only way to override `window.fetch` in page context under MV3 |
| Communication | `window.postMessage` → content script → `chrome.runtime.sendMessage` | Standard safe cross-context bridge |
| Storage | `chrome.storage.local` | Persists across browser restarts, syncs not needed |
| Data retention | 30 rolling days | Enough for weekly views, avoids storage bloat |
| Week start | Monday | ISO standard |
| Token limits | User-configurable, sane defaults | No public API for plan limits |

## URL Patterns Intercepted

The extension watches `https://claude.ai/*` and looks for fetch calls that match:
- Contains `/completion`
- Contains `/chat_conversations`  
- Contains `/append_message`

These are the known claude.ai completion endpoint patterns. If Anthropic changes their routing, the patterns in `page-inject.js` need updating.

## Known Limitations

- **Only works on claude.ai** — does not track API usage made from third-party apps
- **Session-based** — if the browser closes mid-stream, partial counts may be missed
- **Model attribution** — model comes from `message_start` event; unknown if claude.ai overrides it
- **No rate-limit info** — actual plan limits are not exposed by claude.ai; defaults are estimates
- **Free-tier users** — Anthropic may use message counts not token counts; progress bar still shows tokens
