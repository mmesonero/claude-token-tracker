# Claude Token Tracker

Extensión de Chrome que muestra el uso real de límites de Claude directamente en claude.ai — widget integrado debajo del chat + pestaña dashboard al clicar el icono.

## Resultado

### Widget en claude.ai
```
Sesión ████████░░ 25% · 4h 18m  │  Semanal ████░░░░░░ 29% · lun 13:00
┌──────────────────────────────────────────────────────────────────────┐
│ Escribe un mensaje...                                                │
│ +                              Sonnet 4.6 Adaptativo    🎙  ||||    │
└──────────────────────────────────────────────────────────────────────┘
```

### Dashboard (nueva pestaña al clicar el icono)

Pestaña minimalista con fondo oscuro. Dos tarjetas: Sesión (5h) y Semanal, con barra de progreso y tiempo de reset. Icono propio de la extensión en header y favicon. Links a GitHub y LinkedIn en footer. Se refresca automáticamente cada 5 min.

## Qué muestra

| Campo | Fuente API | Descripción |
|---|---|---|
| **Sesión** (naranja) | `five_hour.utilization` | % del límite de sesión (ventana de 5h) |
| **Semanal** (azul) | `seven_day.utilization` | % del límite semanal (todos los modelos) |
| Reset sesión | `five_hour.resets_at` | Tiempo relativo: "4h 18m" |
| Reset semanal | `seven_day.resets_at` | Día y hora: "lun 13:00" |

Datos de la API real: `/api/organizations/{orgId}/usage`. OrgId extraído del cookie `lastActiveOrg`.

## Instalación

### 1. Generar iconos (solo primera vez)

```bash
cd claude-token-tracker
node make-icons.js
```

### 2. Cargar en Chrome

1. Abrir `chrome://extensions`
2. Activar **"Modo de desarrollador"** (arriba derecha)
3. Clic **"Cargar descomprimida"**
4. Seleccionar la carpeta `claude-token-tracker`

### 3. Usar

- **Widget**: ve a **claude.ai** — aparece automáticamente debajo del cuadro de mensaje
- **Dashboard**: clic en el icono de la extensión en la barra de Chrome → abre nueva pestaña

## Compatibilidad

| Navegador | Estado |
|---|---|
| Chrome 109+ | ✅ |
| Edge 109+ | ✅ (Chromium) |
| Firefox | ❌ MV3 diferente |

## Arquitectura

```
content.js         Inyecta widget debajo del chat en claude.ai.
                   Llama a /api/organizations/{orgId}/usage cada 5 min.
                   Guarda datos en chrome.storage.local via STORE_USAGE.
       ↓
background.js      Service worker. Al clicar icono → abre dashboard.html.
                   Fetch directo a la API usando cookie store de Chrome.
                   Handlers: REFRESH_USAGE, STORE_USAGE, GET_STATS, etc.
       ↓
dashboard.html     Nueva pestaña — header con icono propio, dos tarjetas,
dashboard.js       footer con links. Lee liveUsage de storage, onChanged
                   para updates reactivos. JS externo (MV3 CSP).

page-inject.js     Interceptor de window.fetch (contexto de página).
```

## Estructura de archivos

```
claude-token-tracker/
├── manifest.json        MV3 manifest
├── background.js        Service worker
├── content.js           Widget en claude.ai + bridge API → storage
├── page-inject.js       Interceptor fetch (contexto de página)
├── dashboard.html       Pestaña dashboard
├── dashboard.js         Lógica dashboard (externo — MV3 CSP)
├── options.html/css/js  Página de opciones
├── make-icons.js        Generador de PNGs (sin dependencias)
├── icons/               icon16/48/128.png — barras ascendentes sobre círculo naranja
└── docs/                README, ARCHITECTURE, CONTEXT
```

## Notas técnicas

- **MV3 CSP**: scripts inline en páginas de extensión están bloqueados — JS siempre en archivo externo
- **Background fetch**: el service worker hace fetch con `credentials: "include"` a dominios declarados en `host_permissions`
- **Storage como canal**: `chrome.storage.local` + `onChanged` en vez de `sendMessage`/`sendResponse` (poco fiable con service workers dormidos)
- **Iconos**: generados con `make-icons.js` (Node.js puro, sin deps) — PNG con círculo naranja y barras ascendentes

## Licencia

MIT
