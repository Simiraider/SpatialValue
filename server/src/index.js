/**
 * Punto de entrada del worker de gemelos digitales.
 * Arranca Express, la cola de procesamiento y la limpieza TTL periódica.
 */

import crearConfig from './config.js';
import { crearApp } from './app.js';
import { logger } from './utils/logger.js';

const config = crearConfig();
const { app, estado } = crearApp({ config });

// Limpieza periódica: modelos vencidos + subidas huérfanas.
const INTERVALO_LIMPIEZA_MS = 10 * 60 * 1000;
setInterval(() => {
  try {
    estado.limpiarExpirables();
  } catch (e) {
    logger.error('[limpieza] error:', e.message);
  }
}, INTERVALO_LIMPIEZA_MS).unref();

app.listen(config.port, () => {
  logger.info(`✅ Gemelo worker escuchando en :${config.port} (modo=${config.modo})`);
  logger.info(`   Datos: ${config.dataDir} | TTL: ${config.ttlHoras} h | fotos: ${config.minFotos}–${config.maxFotos}`);
  logger.info(`   COLMAP: ${config.colmapBin} | ffmpeg: ${config.ffmpegBin}`);
});

// Apagado limpio.
process.on('SIGTERM', () => {
  logger.info('Apagando…');
  process.exit(0);
});
