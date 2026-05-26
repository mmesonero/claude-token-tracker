# Architecture

## File Map

```
claude-token-tracker/
├── manifest.json          MV3 manifest — permissions, content scripts, action (no popup)
├── background.js          Service worker — abre dashboard tab, fetch API, message bus
├── content.js             Runs on claude.ai — inyecta widget, llama API, bridge a storage
├── page-inject.js         Runs IN page context — wraps window.fetch (pasivo)
├── dashboard.html         Nueva pestaña al clicar icono — UI oscura, dos tarjetas
├── dashboard.js           Lógica dashboard — externo (MV3 CSP bloquea inline scripts)
├── options.html/css/js    Página de opciones (legado)
├── make-icons.js          Node.js — genera PNG sin deps externos
├── icons/
│   ├── icon16.png         16×16 toolbar icon
│   ├── icon48.png         48×48 (usado en dashboard header + favicon)
│   └── icon128.png        128×128 Chrome Web Store
└── docs/
    ├── CONTEXT.md         Decisiones y contexto del proyecto
    ├── ARCHITECTURE.md    Este archivo
    └── README.md          Setup e instalación
```

## Data Flow

```
┌─────────────────────────────────────────────────────┐
│  claude.ai tab                                      │
│                                                     │
│  ┌─────────────────┐                               │
│  │  page-inject.js │  wraps window.fetch (pasivo)  │
│  └─────────────────┘                               │
│                                                     │
│  ┌─────────────────┐                               │
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
           │ (REFRESH_USAGE — desde dashboard o timer)
           ▼
  ┌─────────────────┐
  │  dashboard.js   │  chrome.storage.onChanged → render()
  │  (nueva pestaña)│  setInterval REFRESH_USAGE cada 5 min
  └─────────────────┘
```

## Storage Schema

```javascript
// chrome.storage.local keys:
{
  liveUsage: {
    five_hour: {
      utilization: 25.3,          // % de uso (0-100)
      resets_at: "2026-05-26T23:00:00Z"
    },
    seven_day: {
      utilization: 29.1,
      resets_at: "2026-06-02T13:00:00Z"
    }
  },
  liveUsageAt: 1748210400000,     // unix ms del último fetch

  // Legado (histórico local por token counting):
  usage: {
    "2026-05-26": {
      input: 342100,
      output: 87400,
      models: {
        "claude-sonnet-4-6": { input: 280000, output: 70000 }
      }
    }
    // hasta 30 días
  },
  limits: { daily: 1000000, weekly: 7000000 },
  lastUpdated: 1748210400000
}
```

## Message Protocol

| Origen | Tipo | Payload | Respuesta |
|---|---|---|---|
| content.js → background | `STORE_USAGE` | objeto `liveUsage` de la API | `{ok: true}` |
| dashboard.js → background | `REFRESH_USAGE` | — | `{ok: true}` (fire & forget) |
| content.js → background | `UPDATE_USAGE` | `{model, inputTokens, outputTokens}` | `{ok: true}` |
| cualquiera → background | `GET_STATS` | — | `{today, week, limits, lastUpdated}` |
| options → background | `SET_LIMITS` | `{daily, weekly}` | `{ok: true}` |
| options → background | `EXPORT_DATA` | — | objeto usage completo |
| options → background | `RESET_DATA` | — | `{ok: true}` |

## Design Tokens

```css
/* Fondo / superficie */
--bg:       #0F0E0D   /* casi negro */
--surface:  rgba(255,253,247,.04)
--border:   rgba(255,253,247,.07)

/* Texto */
--text:     #FFFDF7
--muted:    rgba(255,253,247,.35)
--dim:      rgba(255,253,247,.18)

/* Acento */
--orange:   #D4670F   /* sesión (5h) */
--orange-warn:   #F59E0B   /* ≥70% */
--orange-danger: #EF4444   /* ≥90% */
--blue:     #3B82F6   /* semanal */
```

## Decisiones técnicas

**Sin popup** — `chrome.action.onClicked` abre `dashboard.html` como nueva pestaña. Más espacio, sin limitaciones de popup MV3.

**JS externo obligatorio** — MV3 Content Security Policy bloquea `<script>` inline en páginas de extensión. Todo el JS del dashboard está en `dashboard.js`.

**Background fetch** — el service worker puede hacer `fetch` con `credentials: "include"` a URLs en `host_permissions`. Usa el cookie store de Chrome, sin necesidad de que el usuario provea credenciales.

**Storage como canal reactivo** — en vez de `sendMessage`/`sendResponse` (poco fiable cuando el service worker está dormido), se escribe a `chrome.storage.local` y el dashboard escucha con `onChanged`.
