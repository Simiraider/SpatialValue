# API — Gemelo Digital 3D

Dos superficies:

1. **Frontend → Astro**: `GET /api/gemelo/config` (publica la URL del worker).
2. **Navegador → Worker**: toda la subida, el estado y la descarga se hablan
   directo con el worker (`server/`), porque el procesamiento 3D no corre en
   Vercel.

## GET /api/gemelo/config (Astro)

Devuelve la configuración pública del servicio 3D.

```json
{
  "workerUrl": "https://spatial-value-gemelo.onrender.com",
  "minFotos": 5,
  "maxFotos": 100,
  "maxVideoMb": 300,
  "modo": "auto"
}
```

| Campo        | Descripción                                  |
|--------------|----------------------------------------------|
| `workerUrl`  | URL base del worker (vacía si no está configurado) |
| `minFotos`   | Mínimo de fotos para generar                 |
| `maxFotos`   | Máximo de archivos por trabajo               |
| `maxVideoMb` | Máximo por archivo (MB)                      |
| `modo`       | `auto` \| `colmap` \| `simular`              |

## Worker (Express)

Base URL: `WORKER_URL` (variable `PUBLIC_GEMELO_WORKER_URL` en el frontend).

### POST `/api/jobs` — crear trabajo y subir archivos

`multipart/form-data`:

| Campo           | Tipo                | Descripción |
|-----------------|---------------------|-------------|
| `fotos`         | archivo (repetible) | Fotos JPG/PNG/HEIC o un video MP4/MOV. **Obligatorio.** |
| `titulo`        | texto               | Título de la propiedad (opcional). |
| `id_usuario`    | texto               | Id del usuario (opcional). |
| `id_publicacion`| texto               | Id de la tasación asociada (opcional). |
| `opciones`      | JSON                | `{ "calidad": "rapida" \| "equilibrada" \| "alta" }` (opcional). |

Reglas: ≥ `minFotos` fotos **o** 1 video; máximo `maxFotos` archivos; máximo
`maxVideoMb` MB por archivo.

Respuesta `201`:

```json
{
  "id": "g3k7-x9p2-m4q8",
  "estado": "pendiente",
  "totalFotos": 12,
  "esVideo": false,
  "calidadEstimada": "aproximado",
  "tiempoEstimadoSeg": 384,
  "mensaje": "Trabajo creado. Procesando…"
}
```

Errores: `400` (validación), `413` (archivo/ cantidad), `429` (rate limit),
`500` (interno).

### GET `/api/jobs/:id` — estado y progreso

```json
{
  "id": "g3k7-x9p2-m4q8",
  "estado": "procesando",
  "etapa": "reconstruyendo",
  "progreso": 45,
  "mensaje": "Estimando poses de cámara…",
  "totalFotos": 12,
  "nFotos": 12,
  "esVideo": false,
  "calidadEstimada": "aproximado",
  "tiempoEstimadoSeg": 384,
  "modeloUrl": null,
  "modeloBytes": null,
  "error": null,
  "motor": null,
  "creadoEn": 1723300000000,
  "expiraEn": null
}
```

- `estado`: `pendiente` → `recibiendo` → `procesando` → `listo` | `error`.
- `etapa`: `recibiendo` · `extrayendo_frames` · `reconstruyendo` · `convirtiendo` · `listo` · `error`.
- `motor`: `colmap` | `simular` (qué motor generó el modelo).
- Cuando `estado === listo`, `modeloUrl` es `/api/jobs/:id/modelo` (local) o una
  URL firmada de S3/B2, y `expiraEn` indica cuándo se elimina.
- `404` si el trabajo no existe o ya expiró.

### GET `/api/jobs/:id/modelo` — descargar el .glb

- `200` con `Content-Type: model/gltf-binary`. Parámetro opcional
  `?download=1` para forzar `Content-Disposition: attachment`.
- `409` si el modelo aún no está listo.
- `404` si no existe.

### DELETE `/api/jobs/:id` — cancelar y borrar

Borra workspace, fotos temporales y modelo. `204` si existía, `404` si no.

### GET `/api/jobs` — listar recientes (admin)

Requiere `X-Worker-Token` si `WORKER_TOKEN` está configurado.

### GET `/api/healthz`

```json
{
  "ok": true,
  "servicio": "spatial-value-gemelo-worker",
  "modo": "auto",
  "colmapInstalado": true,
  "ffmpegInstalado": true,
  "minFotos": 5,
  "maxFotos": 100,
  "ttlHoras": 1,
  "trabajosActivos": 2
}
```

## Flujo recomendado en el cliente

```
1. GET /api/gemelo/config            → workerUrl, límites
2. POST {worker}/api/jobs (multipart) → id
3. Poll GET {worker}/api/jobs/{id}   (cada 2,5 s) hasta listo/error
4. GET {worker}/api/jobs/{id}/modelo → .glb (visor o descarga)
5. DELETE opcional → liberar antes del TTL
```

El cliente de referencia está en `src/lib/gemelo.ts`.
