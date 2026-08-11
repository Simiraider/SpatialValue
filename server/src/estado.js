/**
 * Registro de trabajos del worker.
 *
 * Sin base de datos (por diseño): el estado de cada trabajo vive en memoria
 * y se persiste a un archivo JSON por trabajo para sobrevivir reinicios
 * parciales. Las fotos y los modelos se guardan SOLO en el filesystem local
 * del worker y se eliminan al expirar el TTL.
 */

import fs from 'node:fs';
import path from 'node:path';
import { generarId } from './utils/id.js';
import { logger } from './utils/logger.js';

export function crearEstado(config) {
  const dirJobs = path.join(config.dataDir, 'jobs');
  const dirTmp = path.join(config.dataDir, 'tmp');
  const trabajos = new Map();

  const rutaDe = (id) => path.join(dirJobs, `${id}.json`);
  const dirDe = (id) => path.join(dirJobs, id);

  const persistir = (job) => {
    try {
      fs.mkdirSync(dirJobs, { recursive: true });
      fs.writeFileSync(rutaDe(job.id), JSON.stringify(job, null, 2), 'utf8');
    } catch (e) {
      logger.error(`[estado] no se pudo persistir ${job.id}:`, e.message);
    }
  };

  /** Carga trabajos previos; los no terminados pasan a 'error' (servicio reiniciado). */
  const cargar = () => {
    fs.mkdirSync(dirJobs, { recursive: true });
    fs.mkdirSync(dirTmp, { recursive: true });
    let archivos = [];
    try {
      archivos = fs.readdirSync(dirJobs).filter((f) => f.endsWith('.json'));
    } catch {
      archivos = [];
    }
    for (const f of archivos) {
      try {
        const job = JSON.parse(fs.readFileSync(path.join(dirJobs, f), 'utf8'));
        if (job.estado !== 'listo' && job.estado !== 'error') {
          job.estado = 'error';
          job.etapa = 'error';
          job.error = 'El servicio se reinició durante el procesamiento. Volvé a intentar.';
          persistir(job);
        }
        trabajos.set(job.id, job);
      } catch (e) {
        logger.warn(`[estado] trabajo corrupto ${f}:`, e.message);
      }
    }
    logger.info(`[estado] ${trabajos.size} trabajos cargados`);
  };

  const crear = (datos) => {
    const ahora = Date.now();
    const job = {
      id: generarId(),
      estado: 'pendiente',
      etapa: 'recibiendo',
      progreso: 0,
      mensaje: 'Encolado…',
      error: null,
      modeloUrl: null,
      modeloBytes: null,
      motor: null,
      creadoEn: ahora,
      actualizadoEn: ahora,
      expiraEn: null,
      ...datos,
    };
    trabajos.set(job.id, job);
    persistir(job);
    return job;
  };

  const actualizar = (id, cambios) => {
    const job = trabajos.get(id);
    if (!job) return null;
    Object.assign(job, cambios, { actualizadoEn: Date.now() });
    persistir(job);
    return job;
  };

  const obtener = (id) => (trabajos.has(id) ? { ...trabajos.get(id) } : null);

  /** Vista pública (sin rutas de filesystem). */
  const publico = (id) => {
    const job = obtener(id);
    if (!job) return null;
    const resto = { ...job };
    delete resto.uploadDir;
    delete resto.modeloPath;
    return resto;
  };

  const listarRecientes = (n = 20) =>
    [...trabajos.values()]
      .sort((a, b) => b.creadoEn - a.creadoEn)
      .slice(0, n)
      .map((j) => ({
        id: j.id,
        estado: j.estado,
        titulo: j.titulo,
        creadoEn: j.creadoEn,
        progreso: j.progreso,
      }));

  const eliminar = (id) => {
    const job = trabajos.get(id);
    if (job) {
      fs.rmSync(dirDe(id), { recursive: true, force: true });
      try {
        fs.unlinkSync(rutaDe(id));
      } catch {
        /* sin archivo */
      }
      trabajos.delete(id);
      return true;
    }
    return false;
  };

  const limpiarExpirables = () => {
    const ahora = Date.now();
    const ttl = config.ttlMs;
    let borrados = 0;
    for (const [id, job] of [...trabajos.entries()]) {
      const expirado = job.expiraEn && job.expiraEn < ahora;
      const terminalViejo =
        (job.estado === 'listo' || job.estado === 'error') &&
        ahora - job.actualizadoEn > Math.max(ttl, 15 * 60 * 1000);
      if (expirado || terminalViejo) {
        eliminar(id);
        borrados++;
      }
    }
    // Limpia subidas huérfanas (requests que fallaron a mitad de camino).
    let tmpViejos = 0;
    try {
      for (const d of fs.readdirSync(dirTmp)) {
        const ruta = path.join(dirTmp, d);
        const stat = fs.statSync(ruta);
        if (ahora - stat.mtimeMs > 60 * 60 * 1000) {
          fs.rmSync(ruta, { recursive: true, force: true });
          tmpViejos++;
        }
      }
    } catch {
      /* sin tmp */
    }
    if (borrados || tmpViejos) {
      logger.info(`[limpieza] ${borrados} trabajos y ${tmpViejos} subidas huérfanas eliminados`);
    }
  };

  const crearDirTmp = () => fs.mkdtempSync(path.join(dirTmp, 'subida-'));

  return {
    crear,
    actualizar,
    obtener,
    publico,
    listarRecientes,
    eliminar,
    limpiarExpirables,
    crearDirTmp,
    dirDe,
    cargar,
    internos: trabajos,
  };
}
