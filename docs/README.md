# Claude Token Tracker

Extensión de Chrome que muestra tu uso real de tokens de Claude directamente en la interfaz de claude.ai — integrado debajo del cuadro de chat, sin popups ni ventanas aparte.

## Resultado

```
      Sesión ████████░░ 57% · 4h 26m  │  Semanal ████░░░░░░ 24% · lun 11:00
┌──────────────────────────────────────────────────────────────────────┐
│ Escribe un mensaje...                                                │
│ +                              Sonnet 4.6 Adaptativo    🎙  ||||    │
└──────────────────────────────────────────────────────────────────────┘
```

## Qué muestra

| Campo | Fuente | Descripción |
|---|---|---|
| **Sesión** (naranja) | `five_hour.utilization` | Uso del límite de sesión (5h) en % |
| **Semanal** (azul) | `seven_day.utilization` | Uso semanal de todos los modelos en % |
| Tiempo de reset | `resets_at` | Para sesión: relativo ("4h 26m"). Para semanal: absoluto ("lun 11:00") |

Los datos vienen de la API real de Anthropic: `/api/organizations/{orgId}/usage`. Se refrescan cada 5 minutos automáticamente.

## Instalación

### 1. Generar iconos (solo la primera vez)

```bash
cd claude-token-tracker
node make-icons.js
```

### 2. Cargar en Chrome

1. `chrome://extensions`
2. Activar **"Modo de desarrollador"** (arriba derecha)
3. Click **"Cargar descomprimida"**
4. Seleccionar la carpeta `claude-token-tracker`

### 3. Usar

Ve a **claude.ai** — el widget aparece automáticamente debajo del cuadro de mensaje.

## Compatibilidad

| Navegador | Estado |
|---|---|
| Chrome 109+ | ✅ |
| Edge 109+ | ✅ (Chromium) |
| Firefox | 🔜 |
| App de escritorio Claude | 🔜 En investigación |

## Arquitectura

```
page-inject.js     Intercepta window.fetch en el contexto de la página
       ↓
content.js         Puente isolated world → background. Inyecta el widget.
                   Llama a /api/organizations/{orgId}/usage para datos reales.
       ↓
background.js      Service worker — almacena histórico local (30 días)
       ↓
popup.html         Vista detallada: Today / This Week + sparkline 7 días
options.html       Configurar límites, exportar datos, reset
```

## Desarrollo

Sin build step. Edita los `.js`, recarga la extensión en `chrome://extensions` (botón 🔄), recarga `claude.ai`.

```
claude-token-tracker/
├── manifest.json
├── background.js        Service worker
├── content.js           Widget injection + API fetch
├── page-inject.js       Fetch interceptor (contexto de página)
├── popup.html/css/js    Popup detallado
├── options.html/css/js  Configuración
├── make-icons.js        Generador de PNGs sin dependencias
├── icons/               icon16/48/128.png
└── docs/                README, ARCHITECTURE, CONTEXT
```

## Licencia

MIT
