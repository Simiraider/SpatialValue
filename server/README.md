# Worker de gemelos digitales 3D

Servicio Express que recibe fotos/video, ejecuta la reconstrucción 3D
(**COLMAP**) o un **simulador** de demostración, y entrega un modelo `.glb`.

```bash
npm install
GEMELO_MODO=simular npm start     # sin COLMAP → simulador (para probar)
GEMELO_MODO=auto npm start        # usa COLMAP si está instalado
```

## Endpoints

| Método | Ruta                      | Descripción |
|--------|---------------------------|-------------|
| POST   | `/api/jobs`               | Crear trabajo + subir fotos/video (multipart) |
| GET    | `/api/jobs/:id`           | Estado y progreso |
| GET    | `/api/jobs/:id/modelo`    | Descargar el .glb (`?download=1` fuerza descarga) |
| DELETE | `/api/jobs/:id`           | Cancelar y borrar |
| GET    | `/api/jobs`               | Recientes (requiere `X-Worker-Token` si está configurado) |
| GET    | `/api/healthz`            | Salud + binarios disponibles |

Detalle en [docs/API-GEMELO.md](../docs/API-GEMELO.md).

## Estructura

```
src/
├── index.js            # Bootstrap + limpieza TTL
├── app.js              # Express (CORS, manejo de errores)
├── config.js           # Config por variables de entorno
├── estado.js           # Registro de trabajos (memoria + JSON, sin BD)
├── routes/jobs.js      # API REST
└── services/
    ├── pipeline.js     # Orquestación del flujo
    ├── ffmpeg.js       # Extracción de frames (video)
    ├── colmap.js       # COLMAP automatic_reconstructor
    ├── mesh.js         # Convertidor PLY → OBJ → GLB
    ├── simulador.js    # GLB procedural de demostración
    ├── confianza.js    # Calidad según nº de fotos
    ├── tiempo.js       # Estimaciones de tiempo
    └── storage.js      # Local + S3/B2 opcional
```

## Privacidad

- Las **fotos nunca se guardan**: se borran al terminar (o fallar) el trabajo.
- Los modelos viven `GEMELO_TTL_HORAS` (default 1 h) y se limpian solos.
- Sin base de datos: el estado se persiste en JSON bajo `GEMELO_DATA_DIR`.

## Tests

```bash
npm test
```
