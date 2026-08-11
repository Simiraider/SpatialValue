# Despliegue — Gemelo Digital 3D

## Resumen

| Componente        | Dónde corre        | Qué necesita                         |
|-------------------|--------------------|--------------------------------------|
| Frontend (Astro)  | Vercel             | `PUBLIC_GEMELO_WORKER_URL`           |
| IA de tasación    | Render (Python)    | (ya existente, sin cambios)          |
| Worker 3D         | Render / VPS / local | Node 20+, disco, opcional COLMAP+ffmpeg |

## 1. Worker en Render (gratis, modo simulación)

El blueprint `render.yaml` ya incluye el servicio `spatial-value-gemelo`
(Node, plan free). En el plan free **no hay disco persistente** y el servicio
duerme tras 15 min de inactividad: los trabajos se pierden al reiniciar y el
primer request puede tardar ~30–60 s en "despertar" el worker. Es suficiente
para demo y pruebas del flujo completo (el simulador genera el .glb).

1. Pushear el repo con `render.yaml` → Render crea los dos servicios.
2. En el servicio `spatial-value-gemelo`:
   - `GEMELO_MODO=auto` (usará COLMAP solo si está instalado; en free siempre
     simula).
   - `CORS_ORIGIN` = dominio del frontend (p.ej. `https://tu-app.vercel.app`).
   - `WORKER_TOKEN` opcional.
3. En Vercel (proyecto Astro): añadir la variable de entorno
   `PUBLIC_GEMELO_WORKER_URL` = `https://spatial-value-gemelo.onrender.com`
   y redeployar.

> Para COLMAP real hace falta una instancia con más recursos (ver abajo). En
> plan free, `GET /api/healthz` reporta `colmapInstalado: false`.

## 2. Worker en un VPS con COLMAP real (Docker)

```bash
# En el VPS (Ubuntu/Debian):
git clone <repo> && cd spatial-value
bash scripts/setup-colmap.sh          # instala ffmpeg + COLMAP (best effort)
cd server
docker build -t spatial-value-gemelo .
docker run -d --name gemelo -p 4000:4000 \
  -e GEMELO_MODO=auto \
  -e GEMELO_DATA_DIR=/data \
  -e CORS_ORIGIN=https://tu-app.vercel.app \
  -v gemelo-data:/data \
  spatial-value-gemelo
```

Alternativa sin Docker:

```bash
cd server
npm ci
GEMELO_MODO=auto CORS_ORIGIN=https://tu-app.vercel.app node src/index.js
```

Verificá: `curl https://vps:4000/api/healthz` debe responder
`colmapInstalado: true`.

## 3. Worker local (desarrollo)

```powershell
# PowerShell (Windows)
cd server
npm install
npm start            # http://localhost:4000
```

```bash
# Bash / macOS / Linux
cd server
npm install
npm start
```

El script `start` carga automáticamente `server/.env` (si existe) con
`node --env-file-if-exists=.env`. El repo ya incluye `server/.env` con
`GEMELO_MODO=simular` (gitignored). Si preferís variables en la terminal:

```powershell
# PowerShell
$env:GEMELO_MODO = "simular"
npm start
```

```bash
# Bash
GEMELO_MODO=simular npm start
```

Y en el frontend:

```powershell
# .env.local (raíz del proyecto Astro) — PowerShell
Add-Content .env.local "PUBLIC_GEMELO_WORKER_URL=http://localhost:4000"
```

## 4. Variables de entorno del worker

| Variable              | Default      | Descripción |
|-----------------------|--------------|-------------|
| `PORT`                | `4000`       | Puerto HTTP |
| `GEMELO_MODO`         | `auto`       | `auto` \| `colmap` \| `simular` |
| `GEMELO_MIN_FOTOS`    | `5`          | Mínimo de fotos por trabajo |
| `GEMELO_MAX_FOTOS`    | `100`        | Máximo de archivos por trabajo |
| `GEMELO_MAX_VIDEO_MB` | `300`        | Tope por archivo |
| `GEMELO_TTL_HORAS`    | `1`          | Horas que vive el modelo |
| `GEMELO_DATA_DIR`     | `./data`     | Directorio de trabajo |
| `GEMELO_MAX_JOBS_POR_IP` | `5`       | Rate limit por IP / 10 min |
| `GEMELO_SIM_VELOCIDAD_MS` | `1200`   | Ritmo de los pasos del simulador |
| `COLMAP_BIN`          | `colmap`     | Binario de COLMAP |
| `FFMPEG_BIN`          | `ffmpeg`     | Binario de ffmpeg |
| `CORS_ORIGIN`         | `*`          | Origen permitido (producción: el del frontend) |
| `WORKER_TOKEN`        | *(vacío)*    | Token para endpoints de admin |
| `S3_BUCKET`/`S3_REGION`/`S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` | *(vacío)* | Almacenamiento opcional del .glb en S3/Backblaze B2 |

## 5. Frontend (Vercel)

| Variable                  | Descripción |
|---------------------------|-------------|
| `PUBLIC_GEMELO_WORKER_URL`| URL pública del worker (visible al navegador) |
| `GEMELO_MODO`             | Opcional, para ajustar estimaciones del cliente |

## 6. Instalación de COLMAP y ffmpeg

`scripts/setup-colmap.sh` intenta:

1. `apt-get install -y ffmpeg` (siempre).
2. `apt-get install -y colmap` (si el paquete existe en la distro).

Si COLMAP no está en los repos, el script imprime las alternativas
(conda-forge: `conda install -c conda-forge colmap`, o build desde fuente
según https://colmap.github.io/install.html). Hasta entonces el worker sigue
funcionando en modo simulación (`GEMELO_MODO=auto`).

## 7. Costos (estrategia gratis primero)

| Recurso                    | Costo |
|----------------------------|-------|
| Vercel (frontend)          | Free |
| Render free (worker, sim)  | $0   |
| VPS pequeño (COLMAP CPU)   | ~$4–6/mes (Hostinger y similares) |
| GPU bajo demanda (opcional)| ~$0.5/h (T4) |
| S3/B2 (opcional)           | ~$0.026/GB-mes |

El diseño no guarda fotos ni modelos por defecto, así que el costo de
almacenamiento es ~cero.
