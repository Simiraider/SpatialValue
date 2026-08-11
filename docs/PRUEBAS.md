# Pruebas

## Ejecutar los tests

```bash
# Todo (frontend + worker) desde la raíz:
npm test

# Solo el worker de reconstrucción:
cd server && npm test

# Solo la librería del frontend:
npx vitest run src/lib/gemelo.test.ts

# Build de producción (valida que el frontend compila):
npm run build
```

## Cobertura

### Worker (`server/test/`, vitest + supertest)

| Archivo             | Qué valida |
|---------------------|------------|
| `confianza.test.js` | Rangos de calidad (5–14 aproximado, 15–29 moderado, 30–59 bueno, ≥60 alto), monotonicidad, mensajes. |
| `tiempo.test.js`    | Puntos de referencia (5≈2 min, 20≈10 min, 50≈40 min, 100≈90 min), monotonicidad, modo simulación, video≈40 fotos, formateo. |
| `glb.test.js`       | Cabecera glTF 2.0, estructura de chunks JSON/BIN, accesoors dentro del bin, índices uint32 con >65k vértices, mallas inválidas. |
| `simulador.test.js` | Genera un .glb válido en disco, determinismo por seed, más fotos → más detalle. |
| `api.test.js`       | Flujo completo por HTTP: crear (validaciones 400/413), procesar hasta `listo`, descargar el .glb, borrar (204), fotos eliminadas post-proceso, `409` antes de listo, token de admin. |

### Frontend (`src/lib/gemelo.test.ts`)

- `calidadPorFotos` debe clasificar igual que el worker (sincronía).
- `tiempoEstimadoSeg` debe coincidir con los puntos de referencia del worker.
- Formateadores de tiempo y bytes.

## Probar el flujo manualmente

1. `cd server && GEMELO_MODO=simular npm start`
2. `PUBLIC_GEMELO_WORKER_URL=http://localhost:4000 npm run dev` (raíz)
3. Entrar a `/gemelo-digital`, subir 5+ fotos y generar.

También podés probar la API con curl:

```bash
# Crear trabajo con 5 fotos de ejemplo
for i in 1 2 3 4 5; do echo "foto" > /tmp/f$i.jpg; done
curl -F "titulo=Demo" -F "fotos=@/tmp/f1.jpg" ... -F "fotos=@/tmp/f5.jpg" http://localhost:4000/api/jobs
curl http://localhost:4000/api/jobs/<id>
curl -o modelo.glb http://localhost:4000/api/jobs/<id>/modelo
```

## CI sugerida

- En cada push: `npm ci`, `npm test`, `npm run build`.
- En el worker (GitHub Actions, ubuntu): instalar ffmpeg, correr `cd server && npm ci && npm test`.
- Opcional: un job con COLMAP instalado que valide `mesh.test.js` con mallas reales.
