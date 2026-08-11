/**
 * App Express del worker. Exporta crearApp() para poder testear con supertest.
 */

import express from 'express';
import crearConfig from './config.js';
import { crearEstado } from './estado.js';
import { crearPipeline } from './services/pipeline.js';
import { crearRouter } from './routes/jobs.js';
import { logger } from './utils/logger.js';

export function crearApp(opciones = {}) {
  const config = opciones.config || crearConfig();
  const estado = opciones.estado || crearEstado(config);
  if (!opciones.estado) estado.cargar();
  const pipeline = opciones.pipeline || crearPipeline({ config, estado });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // CORS (el navegador sube fotos y consulta el estado directamente).
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', config.corsOrigin);
    res.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Worker-Token');
    res.set('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Body JSON solo para metadata (los archivos van por multipart).
  app.use(express.json({ limit: '256kb' }));

  // Root informativo.
  app.get('/', (req, res) => {
    res.json({
      servicio: 'spatial-value-gemelo-worker',
      docs: 'docs/API-GEMELO.md (en el repositorio)',
      endpoints: ['POST /api/jobs', 'GET /api/jobs/:id', 'GET /api/jobs/:id/modelo', 'DELETE /api/jobs/:id', 'GET /api/healthz'],
    });
  });

  app.use('/api', crearRouter({ config, estado, pipeline }));

  app.use((req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `Archivo demasiado grande (máx ${config.maxVideoMb} MB)`.trim() });
    }
    if (err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(413).json({ error: `Demasiados archivos (máx ${config.maxFotos}).` });
    }
    if (err?.name === 'MulterError') {
      return res.status(400).json({ error: `Error al subir archivos: ${err.message}` });
    }
    logger.error('[app] error no controlado:', err?.message || err);
    res.status(500).json({ error: 'Error interno del worker' });
  });

  return { app, config, estado, pipeline };
}
