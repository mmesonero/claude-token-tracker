# Architecture

## File Map

```
claude-token-tracker/
├── manifest.json          MV3 manifest — permissions, content scripts, action
├── background.js          Service worker — storage, stats aggregation, message bus
├── content.js             Runs on claude.ai — injects page-inject.js, bridges messages
├── page-inject.js         Runs IN page context — wraps window.fetch, parses SSE
├── popup.html             Extension toolbar popup UI
├── popup.css              Anthropic-style design tokens + components
├── popup.js               Popup logic — loads stats, renders progress bars
├── options.html           Settings page
├── options.css            Settings page styles
├── options.js             Settings logic — save/load limits, export, reset
├── make-icons.js          Node.js script to generate PNG icons (run once)
├── icons/
│   ├── icon16.png         16×16 toolbar icon
│   ├── icon48.png         48×48 extension management icon
│   └── icon128.png        128×128 Chrome Web Store icon
└── docs/
    ├── CONTEXT.md         Problem, data source strategy, decisions
    ├── ARCHITECTURE.md    This file
    └── README.md          Setup and testing guide
```

## Data Flow

```
┌─────────────────────────────────────────────────────┐
│  claude.ai tab                                      │
│                                                     │
│  ┌─────────────────┐    fetch('/completion', ...)   │
│  │  Page JS        │──────────────────────────────► │
│  │  (React app)    │◄──────────────────────────────│
│  └─────────────────┘    streaming SSE response      │
│          ▲                       │                  │
│          │ (transparent)         │ cloned stream    │
│  ┌───────┴─────────┐            ▼                  │
│  │ page-inject.js  │   parseSSE() → {model,        │
│  │ (page context)  │              inputTokens,      │
│  │ wraps fetch     │              outputTokens}     │
│  └─────────────────┘             │                  │
│          │                       │                  │
│  window.postMessage('CLAUDE_TOKEN_USAGE', data)     │
│          │                                          │
│  ┌───────▼─────────┐                               │
│  │  content.js     │                               │
│  │ (isolated world)│                               │
│  └───────┬─────────┘                               │
└──────────┼──────────────────────────────────────────┘
           │ chrome.runtime.sendMessage('UPDATE_USAGE')
           ▼
  ┌─────────────────┐
  │  background.js  │   chrome.storage.local
  │  service worker │──────────────────────►  { usage: { "2026-05-25": {
  │                 │◄──────────────────────    input: 12345, output: 6789,
  └────────┬────────┘                           models: { "claude-sonnet-4-6":
           │                                              { input, output } }
           │ chrome.runtime.sendMessage('GET_STATS')     } } }
           │
  ┌────────▼────────┐
  │   popup.js      │  renders progress bars
  └─────────────────┘
```

## Storage Schema

```javascript
// chrome.storage.local keys:
{
  usage: {
    "2026-05-25": {
      input: 342100,
      output: 87400,
      models: {
        "claude-sonnet-4-6":  { input: 280000, output: 70000 },
        "claude-opus-4-7":    { input:  62100, output: 17400 }
      }
    },
    "2026-05-24": { ... },
    // up to 30 days retained
  },
  limits: {
    daily:  1000000,   // configurable in options
    weekly: 7000000
  },
  lastUpdated: 1748210400000  // unix ms
}
```

## Message Protocol

| Direction | Type | Payload | Response |
|---|---|---|---|
| content → background | `UPDATE_USAGE` | `{model, inputTokens, outputTokens}` | `{ok: true}` |
| popup → background | `GET_STATS` | — | `{today, week, limits, lastUpdated}` |
| popup → background | `RESET_DATA` | — | `{ok: true}` |
| options → background | `SET_LIMITS` | `{daily, weekly}` | `{ok: true}` |
| options → background | `EXPORT_DATA` | — | full usage object |

## Design Tokens (Anthropic palette)

```css
--accent:          #D4670F   /* primary orange */
--accent-hover:    #B85A0A
--accent-light:    #FEF3C7
--bg:              #FAF9F7   /* warm off-white */
--surface:         #FFFFFF
--border:          #E8E3DA
--text-primary:    #1C1917
--text-secondary:  #78716C
--text-tertiary:   #A8A29E
--progress-bg:     #F0ECE4
--blue:            #3B82F6   /* input tokens */
--purple:          #8B5CF6   /* output tokens */
```
