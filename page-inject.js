// page-inject.js — Runs in PAGE context (not isolated world)
// Wraps window.fetch to intercept claude.ai completion SSE streams.
// Communicates back via window.postMessage.

(function () {
  "use strict";

  const ORIGIN = window.location.origin;
  const URL_PATTERNS = ["/completion", "/chat_conversations", "/append_message"];

  function matchesClaudeAPI(url) {
    return URL_PATTERNS.some((p) => url.includes(p));
  }

  // ── SSE Parser ───────────────────────────────────────────────────────────

  async function parseStream(clonedResponse) {
    let model = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let buffer = "";

    try {
      const reader = clonedResponse.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process all complete SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep the incomplete trailing fragment

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;

          let evt;
          try {
            evt = JSON.parse(raw);
          } catch {
            continue;
          }

          switch (evt.type) {
            case "message_start":
              // Contains model id + input token count
              if (evt.message) {
                if (evt.message.model) model = evt.message.model;
                if (evt.message.usage) {
                  inputTokens += evt.message.usage.input_tokens || 0;
                  outputTokens += evt.message.usage.output_tokens || 0;
                }
              }
              break;

            case "message_delta":
              // Contains final output token count
              if (evt.usage) {
                outputTokens += evt.usage.output_tokens || 0;
              }
              break;

            // content_block_delta events carry text but no token counts
          }
        }
      }
    } catch (_e) {
      // Silent — stream may have been cancelled, page navigated, etc.
    }

    // Emit even if tokens are 0 so caller can decide
    if (inputTokens > 0 || outputTokens > 0) {
      window.postMessage(
        {
          type: "CLAUDE_TOKEN_USAGE",
          model: model || "unknown",
          inputTokens,
          outputTokens,
        },
        ORIGIN
      );
    }
  }

  // ── Fetch Wrapper ────────────────────────────────────────────────────────

  const _fetch = window.fetch;

  window.fetch = async function (...args) {
    // Always call original first — we never block
    const response = await _fetch.apply(this, args);

    try {
      const url =
        args[0] instanceof Request
          ? args[0].url
          : String(args[0]);

      // page-inject.js only runs on claude.ai (web_accessible_resources match),
      // so no need to re-check the host — just match the path patterns.
      if (matchesClaudeAPI(url)) {
        // Clone so we can consume the stream independently
        // (the real response goes to the page untouched)
        const cloned = response.clone();
        parseStream(cloned); // fire-and-forget
      }
    } catch (_e) {
      // Never throw — must not break page fetch behaviour
    }

    return response;
  };
})();
