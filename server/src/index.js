
import crearConfig from './config.js';
import { crearApp } from './app.js';
import { logger } from './utils/logger.js';

const config = crearConfig();
const { app, estado } = crearApp({ config });

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

process.on('SIGTERM', () => {
  logger.info('Apagando…');
  process.exit(0);
});
