# Claude Token Tracker

Browser extension that shows your Claude AI token consumption as Anthropic-styled progress bars — daily and weekly, broken down by model.

![popup preview: orange progress bars, Claude dark orange on white, Today / This Week tabs]

## Features

- **Live tracking** — intercepts claude.ai streaming responses; no API key needed
- **Daily & weekly views** — see tokens used today vs. this week
- **All models** — Sonnet, Opus, Haiku, Haiku 4.5, etc. tracked separately
- **Input / Output split** — know whether you're spending on context or generation
- **Configurable limits** — set your own daily/weekly cap in Settings
- **Compact** — 320 px popup, zero injected UI on the page

## Quick Start

### 1. Generate icons (first time only)

```bash
cd claude-token-tracker
node make-icons.js
```

Requires Node.js 16+. Creates `icons/icon16.png`, `icon48.png`, `icon128.png`.

### 2. Load as unpacked extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `claude-token-tracker/` folder

The extension icon appears in the toolbar.

### 3. Use it

1. Go to **claude.ai** and have any conversation
2. Click the extension icon to see your usage

## Settings

Click ⚙ in the popup or go to the extension's Options page to configure:

- **Daily limit** (default: 1,000,000 tokens)
- **Weekly limit** (default: 7,000,000 tokens)
- **Export data** as JSON
- **Reset all data**

> **Note:** Anthropic doesn't publish exact token limits per plan. The defaults are reasonable estimates for the Pro plan. Adjust to match your actual plan limits.

## How It Works

The extension injects a tiny script into the claude.ai page context that wraps `window.fetch`. When a completion response streams back, it clones the response (without affecting the real stream), reads the Server-Sent Events, and extracts token counts from `message_start` and `message_delta` events. Data is stored locally in `chrome.storage.local` — nothing leaves your browser.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [CONTEXT.md](CONTEXT.md) for full technical details.

## Browser Compatibility

| Browser | Status |
|---|---|
| Chrome 109+ | ✅ Fully supported |
| Edge 109+ | ✅ Fully supported (Chromium) |
| Firefox | 🔜 Planned (MV2 compatible port) |
| Safari | 🔜 Planned |

## Roadmap

- [ ] Firefox / Safari port
- [ ] Optional Anthropic API key for historical usage fetch
- [ ] Daily usage chart (7-day sparkline)
- [ ] Notification when approaching limit
- [ ] Claude desktop app integration

## Development

```bash
# After making changes to any .js file:
# Go to chrome://extensions → find the extension → click the refresh icon
# (No build step needed — plain JS, no bundler)
```

## License

MIT
