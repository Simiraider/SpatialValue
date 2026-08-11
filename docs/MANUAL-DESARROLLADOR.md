# Manual de Inicialización para Desarrolladores

> **Para quién**: developers que reciben este repositorio (rama `visor-3d`) y necesitan
> levantarlo, entenderlo y modificarlo desde cero. Asume que una IA construyó el
> sistema y que el equipo lo va a auditar y portar a la rama principal.

---

## 1. ¿Qué es esto?

**SpatialValue** es una plataforma de tasación de propiedades con 3 componentes:

| Componente | Stack | Dónde vive |
|---|---|---|
| **Frontend** | Astro 6 + React 19 + Tailwind 4 + TypeScript | `src/` |
| **IA de tasación** (precios) | FastAPI / Python | `src/pages/Apis/api_ia.py` |
| **Worker 3D** ("gemelo digital") | Node + Express + COLMAP + ffmpeg | `server/` |

El **gemelo digital 3D** es el feature nuevo de esta rama: el usuario sube fotos
(o un video) desde el navegador, el worker ejecuta **fotogrametría** (COLMAP) y
devuelve un modelo `.glb` que se visualiza con `<model-viewer>`.

**Regla de oro de la arquitectura**: COLMAP y ffmpeg no pueden correr en Vercel
(serverless), por eso el procesamiento 3D vive en un **worker aparte** que se
comunica con el frontend por HTTP. Sin bases de datos para este flujo: el estado
de cada trabajo se persiste en JSON local y las fotos **nunca se guardan**.

---

## 2. Estructura del repositorio

```
.
├── src/                          # Frontend Astro
│   ├── pages/
│   │   ├── gemelo-digital.astro  # Página del gemelo 3D
│   │   ├── api/gemelo/config.js  # Endpoint que publica la URL del worker
│   │   ├── Apis/                 # Endpoints serverless (tasación, login, IA)
│   │   └── *.astro               # index, login, registro, tasacion, reporte…
│   ├── components/GemeloDigital/ # FlujoGemelo, SubidaFotos, BarraProgreso, Visor3D, AvisoConfianza
│   ├── components/               # PropertyForm (checkbox "Generar gemelo 3D"), dashboard…
│   ├── lib/gemelo.ts             # Cliente del worker (subir, polling, descargar)
│   └── lib/gemelo.test.ts        # Tests del cliente
├── server/                       # WORKER 3D (Express) — es un proyecto Node aparte
│   ├── src/
│   │   ├── index.js              # Bootstrap + limpieza TTL
│   │   ├── app.js                # Express (CORS, errores)
│   │   ├── config.js             # Config por variables de entorno
│   │   ├── estado.js             # Registro de trabajos (memoria + JSON)
│   │   ├── routes/jobs.js        # API REST
│   │   └── services/
│   │       ├── pipeline.js       # Orquestación del flujo (encola trabajos)
│   │       ├── ffmpeg.js         # Extracción de frames de video
│   │       ├── colmap.js         # COLMAP automatic_reconstructor
│   │       ├── mesh.js           # Convertidor PLY → OBJ → GLB
│   │       ├── simulador.js      # GLB procedural de demostración
│   │       ├── confianza.js      # Calidad según nº de fotos
│   │       ├── tiempo.js         # Estimación de tiempos
│   │       └── storage.js        # Local + S3/Backblaze B2 opcional
│   └── test/                     # 34 tests (vitest + supertest)
├── docs/                         # Toda la documentación
├── scripts/
│   ├── setup-colmap.sh           # Instala ffmpeg + COLMAP en Ubuntu/Debian
│   └── validar-glb.mjs           # Valida la estructura de un .glb
├── .env.example                  # Variables del frontend (copiar a .env.local)
├── render.yaml                   # Blueprint de Render (IA + worker 3D)
└── vercel.json                   # Cron de reentrenamiento de la IA
```

---

## 3. Requisitos previos

| Requisito | Versión | Notas |
|---|---|---|
| Node.js | **≥ 22.12** (raíz) / ≥ 22.9 (worker) | `node --version` |
| Python | 3.12+ | Solo para la IA de tasación |
| ffmpeg | cualquiera reciente | Solo para el worker (video + COLMAP dense) |
| COLMAP | ≥ 3.11 | **Opcional**: sin él, el worker usa modo simulación |
| WSL2 + Ubuntu | — | Solo Windows, solo si querés COLMAP real local |

> 💡 **Windows sin WSL**: todo funciona igual, pero sin COLMAP. El worker genera
> modelos de demostración (modo `simular`). Para fotogrametría real en Windows
> necesitás WSL2 (ver sección 8).

---

## 4. Puesta en marcha (primera vez)

### 4.1 Instalar dependencias

```bash
# Raíz (frontend + tests)
npm install

# Worker (proyecto Node aparte)
cd server && npm install && cd ..
```

### 4.2 Crear los archivos de entorno

**Frontend** — copiá `.env.example` a `.env.local` en la raíz:

```bash
cp .env.example .env.local        # Linux/macOS/WSL
copy .env.example .env.local      # Windows (cmd)
```

**Worker** — copiá `server/.env.example` a `server/.env`:

```bash
cp server/.env.example server/.env
```

El `.env` del worker por defecto usa `GEMELO_MODO=auto`: si COLMAP está
instalado lo usa; si no, genera modelos de demostración. **No hace falta tocar
nada para un primer arranque.**

> ⚠️ Los `.env` reales NO se commitean (están en `.gitignore`). Los `.env.example`
> SÍ se commitean: mantenelos al día cuando agregues variables.

### 4.3 Levantar los 3 servicios (3 terminales)

**Terminal 1 — Worker 3D** (puerto 4000):

```bash
cd server && npm start
```

Deberías ver:
```
✅ Gemelo worker escuchando en :4000 (modo=auto)
   Datos: ./data | TTL: 1 h | fotos: 5–100
   COLMAP: colmap | ffmpeg: ffmpeg
```

**Terminal 2 — Frontend** (puerto 4321):

```bash
npm run dev
```

**Terminal 3 — IA de tasación** (puerto 8000, opcional):

```bash
python src/pages/Apis/api_ia.py
```

> `npm run dev` en realidad levanta IA + Astro juntos con `concurrently`. Si no
> querés la IA, corré solo `npx astro dev`.

### 4.4 Verificar que todo está conectado

```powershell
# 1) El worker responde y reporta COLMAP:
curl http://localhost:4000/api/healthz
# → {"ok":true,"modo":"auto","colmapInstalado":true|false,"ffmpegInstalado":true,...}

# 2) El frontend publica la URL del worker:
curl http://localhost:4321/api/gemelo/config
# → {"workerUrl":"http://localhost:4000",...}
```

Después abrí **http://localhost:4321/gemelo-digital** y subí 5+ fotos (o un video).

---

## 5. El flujo del gemelo 3D, explicado

### 5.1 Ciclo de vida de un trabajo

```
POST /api/jobs (multipart: fotos o video)
        │
        ▼
   ┌─ pendiente/recibiendo ─┐
   │  (video) extrayendo_frames ← ffmpeg: 1 cuadro cada 3 s
   │  reconstruyendo         ← COLMAP (o simulador)
   │  convirtiendo           ← PLY → OBJ → GLB (mesh.js)
   └──────┬──────────────────┘
          ▼
   listo (modelo.glb, TTL 1 h)   |   error (mensaje claro)
```

El frontend hace **polling** cada 2,5 s a `GET /api/jobs/:id` mientras la
`BarraProgreso` muestra la etapa actual (mensaje real del worker).

### 5.2 Los 3 modos del worker (`GEMELO_MODO`)

| Modo | Comportamiento |
|---|---|
| `auto` | **Por defecto.** Usa COLMAP si está instalado; si no, simulador. |
| `colmap` | Fuerza COLMAP. Falla con error claro si no está instalado. |
| `simular` | Siempre genera el modelo de demostración (procedural, sin COLMAP). |

### 5.3 Simulador vs. reconstrucción real

- **Simulador** (`simulador.js`): genera una maqueta procedural (piso + cajas de
  habitaciones) con seed determinística. Sirve para probar el flujo completo
  gratis: subida → progreso → visor → descarga.
- **COLMAP real**: reconstruye la geometría real de la propiedad y produce una
  malla con **los colores de los vértices** tomados de las fotos. La etiqueta
  del visor dice `modelo N fotos` (no "modelo de demostración").

### 5.4 Calidad y tiempos estimados

Ambas lógicas están **duplicadas a propósito** entre el worker
(`server/src/services/`) y el frontend (`src/lib/gemelo.ts`) porque el frontend
las necesita para mostrar avisos antes de subir. **Si cambiás una, cambiá la otra**
(los tests de ambos lados verifican que coincidan en los puntos clave).

- **Confianza** (`confianza.js` / `calidadPorFotos`): 5–14 aproximado · 15–29
  moderado · 30–59 bueno · ≥60 alta fidelidad.
- **Tiempos** (`tiempo.js` / `tiempoEstimadoSeg`): interpolación lineal entre
  puntos de referencia (5 fotos ≈ 2 min … 100 fotos ≈ 90 min).

### 5.5 Privacidad y retención (por diseño)

- Las **fotos se borran siempre** al terminar (o fallar) el trabajo. `GEMELO_KEEP_FOTOS=1` las conserva solo para debug.
- El modelo `.glb` vive `GEMELO_TTL_HORAS` (default 1 h) en `server/data/` y una
  limpieza periódica (cada 10 min) borra trabajos vencidos.
- No hay base de datos: el estado es JSON por trabajo bajo `server/data/jobs/`.

---

## 6. API del worker (resumen)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/jobs` | Crear trabajo + subir fotos/video (multipart, campo `fotos`) |
| GET | `/api/jobs/:id` | Estado, progreso, mensaje, motor usado |
| GET | `/api/jobs/:id/modelo` | Descargar el `.glb` (`?download=1` fuerza descarga) |
| DELETE | `/api/jobs/:id` | Cancelar y borrar |
| GET | `/api/jobs` | Recientes (requiere `X-Worker-Token` si está configurado) |
| GET | `/api/healthz` | Salud + binarios disponibles + trabajos activos |

Detalle completo en [`docs/API-GEMELO.md`](API-GEMELO.md).

---

## 7. Variables de entorno (referencia completa)

### Frontend (`.env.local` en la raíz)

| Variable | Descripción | Default |
|---|---|---|
| `PUBLIC_GEMELO_WORKER_URL` | URL pública del worker (la ve el navegador) | `http://localhost:4000` |
| `IA_URL` | URL de la IA de tasación | `http://127.0.0.1:8000` |
| `SpatialValueStorage_DATABASE_URL` | PostgreSQL Neon (tasaciones) | — |

### Worker (`server/.env`)

| Variable | Descripción | Default |
|---|---|---|
| `PORT` | Puerto HTTP | `4000` |
| `GEMELO_MODO` | `auto` \| `colmap` \| `simular` | `auto` |
| `GEMELO_MIN_FOTOS` / `GEMELO_MAX_FOTOS` | Límites de fotos por trabajo | `5` / `100` |
| `GEMELO_MAX_VIDEO_MB` | Tamaño máx. de un video | `300` |
| `GEMELO_TTL_HORAS` | Horas que vive el modelo | `1` |
| `GEMELO_DATA_DIR` | Directorio de trabajo | `./data` |
| `COLMAP_BIN` / `FFMPEG_BIN` | Binarios | `colmap` / `ffmpeg` |
| `CORS_ORIGIN` | Origen permitido (`*` en dev) | `*` |
| `WORKER_TOKEN` | Token opcional para `/api/jobs` (admin) | vacío |
| `GEMELO_KEEP_FOTOS` | `1` = no borrar fotos (debug) | `0` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Storage en S3/B2 opcional | vacío |
| `GEMELO_SIM_VELOCIDAD_MS` | Velocidad de la demo simulada | `1200` |

---

## 8. WSL2 + COLMAP en Windows (para reconstrucción real)

El worker detecta COLMAP con `colmap help` (⚠️ COLMAP ≥ 3.11 **no** soporta
`--version`; ese cambio rompió la detección y fue un bug real de esta rama).

```bash
# Dentro de WSL2/Ubuntu
sudo apt update
sudo apt install -y ffmpeg colmap

# Si tira "error while loading shared libraries: libPoseLib.so":
sudo apt install -y libposelib

# Verificar (usa help, no --version):
colmap help | head -2   # → "COLMAP 3.12.x ..."
```

El worker corre dentro de WSL escuchando en `:4000`, y Windows lo ve por
`localhost:4000` (forwarding automático de WSL2). **Ojo**: si el puerto 4000 ya
lo usa otro proceso de Windows, hay conflicto — cerrá el otro primero.

Guía paso a paso (incluida la copia del proyecto a WSL, sin `node_modules`):
[`docs/COLMAP-WINDOWS.md`](COLMAP-WINDOWS.md).

> ⚠️ **No copies el repo entero a WSL con `cp -r`**: arrastra cientos de MB de
> `node_modules` por el puente NTFS↔Linux. Copiá solo `server/` con `tar` o un
> rsync excluyendo `node_modules`.

---

## 9. Scraper de licenciados (herramienta aparte)

`LicenciadoScraper.js` (raíz) scrapea propiedades para alimentar la IA. Corre
automáticamente cada 12 h vía GitHub Actions (`.github/workflows/scraper.yml`,
necesita el secret `DATABASE_URL`). Para correrlo localmente con debug:

```bash
# 1) Traer las variables de producción (incluye DATABASE_URL)
npx vercel env pull .env.local

# 2) Levantar la IA de tasación (la usa el scraper para estimar precios)
python src/pages/Apis/api_ia.py

# 3) Chrome en modo debug para el scraping
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-debug"

# 4) Correr el scraper (Node 22+)
npx tsx --env-file=.env.local ./LicenciadoScraper.js
```

Los datos crudos del scraper viven en `dataset_propiedades.json` (raíz) y el
perfil de Chrome de debug en `chrome_scraper_data/` (gitignored, no commitear).

---

## 10. Tests

```bash
npm test                # raíz: tests del frontend (cliente gemelo + otros)
cd server && npm test   # worker: 34 tests (API, GLB, mesh, simulador, colmap…)
npm run build           # build de producción (Vercel)
```

Cobertura clave del worker: `glb.test.js` (valida estructura del GLB),
`mesh.test.js` (PLY→OBJ→GLB con PLY binario y ASCII), `colmap.test.js`
(detección del binario), `simulador.test.js`, `api.test.js` (supertest sobre los
endpoints). Ver [`docs/PRUEBAS.md`](PRUEBAS.md).

---

## 11. Troubleshooting (errores que ya pasaron y cómo se resolvieron)

### "No se pudo conectar con el servicio de reconstrucción 3D"
El frontend no llega al worker. Verificá:
1. `curl http://localhost:4000/api/healthz` desde PowerShell (debe responder).
2. `PUBLIC_GEMELO_WORKER_URL=http://localhost:4000` en `.env.local` (raíz).
3. Reiniciá `npm run dev` después de cambiar el `.env.local` (Astro cachea env).

### "El worker 3D no responde"
Mismo diagnóstico, pero también: si el worker está en WSL, asegurate de que el
puerto 4000 no lo tenga ocupado un proceso de Windows (el de Windows le gana al
forwarding de WSL).

### El modelo sale como "modelo de demostración" con COLMAP instalado
COLMAP corrió pero **no encontró suficientes coincidencias** entre las fotos.
Causas (todas verificadas en esta rama):
- **Fotos sin solapamiento**: una toma por ambiente no sirve. Cada zona debe
  verse en **≥3 fotos** con 60–80% de solapamiento.
- **Video de baja resolución**: videos re-comprimidos (WhatsApp/Instagram, 480p)
  no tienen features. El worker ahora los **rechaza antes** con un mensaje claro
  (mínimo 600px en el lado menor). Grabá con la cámara en 1080p+ y pasalo por
  cable/Drive, nunca por redes sociales.
- **Frames casi duplicados** (video en cámara lenta a 1 fps): el worker extrae
  **1 cuadro cada 3 s** para garantizar baseline real entre vistas.

Diagnóstico real: revisá la base de datos de COLMAP del trabajo fallido en
`server/data/jobs/<id>/output/colmap/database.db` (tabla `two_view_geometries`)
para ver cuántos pares de fotos se matchearon de verdad.

### "Failed to fetch dynamically imported module: ...model-viewer..."
Caché vieja de Vite. En `astro.config.mjs` ya está `optimizeDeps.include` para
`@google/model-viewer/dist/model-viewer-module.min.js`. Si vuelve a pasar:
borrá `.astro/` y `node_modules/.vite/` y reiniciá `npm run dev`.

### `GEMELO_MODO` inválido
El worker valida el modo y aborta con un error claro. Usá `auto | colmap | simular`.

### COLMAP detectado pero "Command `--version` not recognized"
Es el bug de detección ya corregido (el worker usa `colmap help`). Si seguís
viéndolo, el worker está corriendo código viejo: reinicialo.

---

## 12. Despliegue (resumen)

- **Frontend** → Vercel (adapter de Astro ya configurado). Definir
  `PUBLIC_GEMELO_WORKER_URL` en Vercel.
- **Worker 3D** → Render (plan free, sin COLMAP → modo simulación) o VPS con
  Docker + COLMAP (el `Dockerfile` de `server/` instala ambos). El primer request
  de un plan free puede tardar 30–60 s en "despertar".
- **IA** → Render (blueprint en `render.yaml`).

Pasos completos en [`docs/DESPLIEGUE.md`](DESPLIEGUE.md).

---

## 13. Limitaciones conocidas y próximos pasos

1. **COLMAP en CPU es lento y exigente con el material de entrada** (nitidez +
   solapamiento). Es la limitación física de la fotogrametría, no un bug.
2. **El "fotorrealismo tipo Luma AI" (Gaussian Splatting / NeRF) NO es posible
   con esta arquitectura**: requiere GPU NVIDIA con CUDA y horas de
   entrenamiento. Está documentado como roadmap futuro (requeriría un servicio
   en la nube con GPU).
3. **Duplicación intencional** de confianza/tiempos entre worker y frontend:
   mantener sincronizados.
4. **Cola de procesamiento** actual es en memoria (un solo worker). Para
   producción con muchos usuarios, habría que moverla a Redis/cola externa.

---

## 14. Checklist de handover (antes de portar a la rama principal)

- [ ] `npm install` limpio en raíz y en `server/`
- [ ] `npm test` y `cd server && npm test` en verde
- [ ] `npm run build` pasa
- [ ] `.env.example` (raíz y `server/`) al día con TODAS las variables usadas
- [ ] Verificar con `curl /api/healthz` que el worker reporta el modo correcto
- [ ] Probar `/gemelo-digital` con un video de calidad (1080p+) hasta ver un
      modelo real (no demostración)
- [ ] Revisar que no queden `console.log` de debug ni archivos de prueba sueltos
- [ ] Actualizar esta sección con cualquier variable o paso nuevo que agreguen
