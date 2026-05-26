# Claude Token Tracker

Extensión de Chrome que muestra el uso real de límites de Claude directamente en claude.ai — widget integrado debajo del chat + pestaña dashboard al clicar el icono.

## Resultado

### Widget en claude.ai
```
🟠 Sesión ████████░░ 21% · 4h 30m  │  Semanal ████░░░░░░ 29% · lun 13:00
┌──────────────────────────────────────────────────────────────────────┐
│ Escribe un mensaje...                                                │
│ +                              Sonnet 4.6 Adaptativo    🎙  ||||    │
└──────────────────────────────────────────────────────────────────────┘
```

### Dashboard (nueva pestaña al clicar el icono)

Pestaña minimalista con el look de Claude. Dos tarjetas: Sesión (5h) y Semanal, con barra de progreso y tiempo de reset. Se refresca automáticamente cada 5 min.

## Qué muestra

| Campo | Fuente API | Descripción |
|---|---|---|
| **Sesión** (naranja) | `five_hour.utilization` | % del límite de sesión (ventana de 5h) |
| **Semanal** (azul) | `seven_day.utilization` | % del límite semanal (todos los modelos) |
| Reset sesión | `five_hour.resets_at` | Tiempo relativo: "4h 30m" |
| Reset semanal | `seven_day.resets_at` | Día y hora: "lun 13:00" |

Datos de la API real: `/api/organizations/{orgId}/usage`. Se leen el orgId del cookie `lastActiveOrg`.

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
- **Dashboard**: clic en el icono 🟠 de la extensión en la barra de Chrome → abre nueva pestaña

## Compatibilidad

| Navegador | Estado |
|---|---|
| Chrome 109+ | ✅ |
| Edge 109+ | ✅ (Chromium) |
| Firefox | ❌ MV3 diferente |

## Arquitectura

```
content.js         Inyecta widget en claude.ai. Llama a /api/organizations/{orgId}/usage.
                   Guarda datos en chrome.storage.local via STORE_USAGE.
       ↓
background.js      Service worker. Abre dashboard.html al clicar icono.
                   Fetch directo a la API (usa cookie store de Chrome).
                   Responde REFRESH_USAGE y STORE_USAGE.
       ↓
dashboard.html     Nueva pestaña — lee liveUsage de storage, escucha onChanged.
dashboard.js       Lógica del dashboard (archivo externo — MV3 CSP requiere esto).

page-inject.js     Interceptor de window.fetch (contexto de página, no usado activamente).
```

## Desarrollo

Sin build step. Edita los `.js`, recarga la extensión en `chrome://extensions` (botón 🔄).

```
claude-token-tracker/
├── manifest.json
├── background.js        Service worker
├── content.js           Widget injection + API fetch + bridge
├── page-inject.js       Fetch interceptor (contexto de página)
├── dashboard.html       Pestaña dashboard
├── dashboard.js         Lógica dashboard (externo por MV3 CSP)
├── options.html/css/js  Configuración (legado)
├── make-icons.js        Generador de PNGs sin dependencias
├── icons/               icon16/48/128.png
└── docs/                README, ARCHITECTURE, CONTEXT
```

## Notas técnicas

- **MV3 CSP**: scripts inline en páginas de extensión están bloqueados — todo JS debe ser externo
- **Background fetch**: el service worker puede hacer fetch con `credentials: "include"` a dominios en `host_permissions`
- **Storage como canal**: en lugar de `sendMessage`/`sendResponse` (poco fiable con service workers dormidos), se usa `chrome.storage.local` + `onChanged`

## Licencia

MIT
