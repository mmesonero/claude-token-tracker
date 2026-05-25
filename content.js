// content.js — Isolated world content script running on claude.ai
// Injects page-inject.js into the page context, then bridges postMessage → runtime.

(function () {
  "use strict";

  // ── Inject page-inject.js into the real page context ──────────────────────
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("page-inject.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  // ── Listen for usage events from the injected script ──────────────────────
  window.addEventListener("message", (event) => {
    // Only accept messages from our injected script (same origin)
    if (
      event.source !== window ||
      !event.data ||
      event.data.type !== "CLAUDE_TOKEN_USAGE"
    ) return;

    const { model, inputTokens, outputTokens } = event.data;

    // Basic validation — ignore zero-count events
    if (!inputTokens && !outputTokens) return;

    chrome.runtime.sendMessage(
      {
        type: "UPDATE_USAGE",
        data: { model, inputTokens: inputTokens || 0, outputTokens: outputTokens || 0 },
      },
      () => {
        // Swallow errors (popup might be closed)
        void chrome.runtime.lastError;
      }
    );
  });
})();
