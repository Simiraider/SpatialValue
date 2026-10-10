
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

const CALIDAD_SIFT = {
  rapida:      { maxImageSize: 1200, maxFeatures: 4096 },
  equilibrada: { maxImageSize: 1600, maxFeatures: 8192 },
  alta:        { maxImageSize: 2400, maxFeatures: 16384 },
  auto:        { maxImageSize: 1600, maxFeatures: 8192 },
};

export function salidaPareceColmap(salida) {
  return /COLMAP/i.test(String(salida || ''));
}

export function colmapDisponible(colmapBin) {
  try {
    const help = spawnSync(colmapBin, ['help'], { encoding: 'utf8', timeout: 10000 });
    if (salidaPareceColmap(help.stdout) || salidaPareceColmap(help.stderr)) return true;
    const version = spawnSync(colmapBin, ['--version'], { encoding: 'utf8', timeout: 10000 });
    return salidaPareceColmap(version.stdout) || salidaPareceColmap(version.stderr);
  } catch {
    return false;
  }
}


function correrEtapa(colmapBin, subcomando, args, { ref, onLog, timeoutMs = 30 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    const fullArgs = [subcomando, ...args];
    logger.info(`[colmap] ${subcomando} ${args.slice(0, 8).join(' ')}…`);

    const proc = spawn(colmapBin, fullArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    ref.proc = proc;

    const log = [];
    let stderr = '';
    let timer = null;
    let terminado = false;

    const finalizar = () => {
      if (terminado) return;
      terminado = true;
      clearTimeout(timer);
      ref.proc = null;
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (proc.exitCode === null) proc.kill('SIGKILL');
        finalizar();
        reject(new Error(`COLMAP ${subcomando} superó el timeout (${Math.round(timeoutMs / 60000)} min).`));
      }, timeoutMs);
    }

    proc.stderr.on('data', (d) => {
      const line = d.toString().trim();
      if (!line) return;
      stderr = stderr + line.slice(-2000) + '\n';
      if (log.length < 300) log.push(line);
      if (onLog) onLog(line.slice(0, 300));
    });

    proc.on('error', (err) => {
      finalizar();
      reject(err);
    });

    proc.on('close', (code) => {
      finalizar();
      if (code !== 0) {
        reject(new Error(`COLMAP ${subcomando} terminó con código ${code}. ${stderr.slice(-500)}`));
        return;
      }
      resolve({ log });
    });
  });
}


function contarImagenesModelo(modelo, colmapBin) {
  let tmp = null;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-modelo-'));
    const r = spawnSync(colmapBin, [
      'model_converter',
      '--input_path', modelo,
      '--output_path', tmp,
      '--output_type', 'TXT',
    ], { stdio: 'ignore', timeout: 60 * 1000 });
    if (r.status !== 0) return 0;
    const txt = fs.readFileSync(path.join(tmp, 'images.txt'), 'utf8');
    return txt.split(/\r?\n/).filter((l) => /\.(jpe?g|png|webp|bmp)/i.test(l)).length;
  } catch {
    return 0;
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}


export function elegirMejorModelo(sparsePath, colmapBin = 'colmap') {
  if (!fs.existsSync(sparsePath)) return null;

  const modelos = fs.readdirSync(sparsePath)
    .filter((d) => /^\d+$/.test(d) && fs.statSync(path.join(sparsePath, d)).isDirectory());

  if (!modelos.length) return null;

  // Para MVS conviene el modelo con mas camaras registradas (cobertura);
  // los puntos3D desempatan. Si el conteo falla, manda el tamano de puntos.
  let mejor = null;
  let mejorImagenes = -1;
  let mejorTam = -1;
  for (const m of modelos) {
    const carpeta = path.join(sparsePath, m);
    let tam = 0;
    try {
      tam = fs.statSync(path.join(carpeta, 'points3D.bin')).size;
    } catch {
      continue;
    }
    const imagenes = contarImagenesModelo(carpeta, colmapBin);
    if (imagenes > mejorImagenes || (imagenes === mejorImagenes && tam > mejorTam)) {
      mejorImagenes = imagenes;
      mejorTam = tam;
      mejor = carpeta;
    }
  }

  return mejor;
}


export function elegirMatching(esVideo, dbPath) {
  if (esVideo) {
    return {
      subcomando: 'sequential_matcher',
      args: ['--database_path', dbPath, '--SequentialMatching.overlap', '10'],
    };
  }
  return {
    subcomando: 'exhaustive_matcher',
    args: ['--database_path', dbPath, '--SiftMatching.guided_matching', '1'],
  };
}

export function ejecutarColmap(
  colmapBin,
  { imagePath, workspacePath, calidad = 'equilibrada', esVideo = false, onLog, onProgreso, timeoutMs = 3 * 3600 * 1000 }
) {
  const ref = { proc: null };
  let cancelado = false;

  const detener = () => {
    cancelado = true;
    if (ref.proc && ref.proc.exitCode === null) {
      try { ref.proc.kill('SIGKILL'); } catch {  }
    }
  };

  const promesa = (async () => {
    if (!colmapDisponible(colmapBin)) {
      throw new Error('COLMAP no está instalado en el worker (GEMELO_MODO=colmap o auto sin binario).');
    }

    fs.mkdirSync(workspacePath, { recursive: true });
    const dbPath = path.join(workspacePath, 'database.db');
    const sparsePath = path.join(workspacePath, 'sparse');
    fs.mkdirSync(sparsePath, { recursive: true });

    const sift = CALIDAD_SIFT[calidad] || CALIDAD_SIFT.equilibrada;
    const allLogs = [];
    const t0 = Date.now();

    const chequearCancelado = () => {
      if (cancelado) throw new Error('Trabajo cancelado por el usuario.');
    };

    const chequearTimeout = (etapaNombre) => {
      if (Date.now() - t0 > timeoutMs) {
        throw new Error(`COLMAP superó el tiempo máximo en la etapa "${etapaNombre}".`);
      }
    };

    chequearCancelado();
    if (onProgreso) onProgreso(30, 'Extrayendo características de las fotos (SIFT)…');
    const r1 = await correrEtapa(colmapBin, 'feature_extractor', [
      '--database_path', dbPath,
      '--image_path', imagePath,
      '--ImageReader.single_camera', '1',
      '--SiftExtraction.max_image_size', String(sift.maxImageSize),
      '--SiftExtraction.max_num_features', String(sift.maxFeatures),
    ], { ref, onLog, timeoutMs: 180 * 60 * 1000 }); 
    allLogs.push(...r1.log);

    chequearCancelado();
    chequearTimeout('matching');
    const { subcomando: subcomandoMatch, args: argsMatch } = elegirMatching(esVideo, dbPath);
    if (onProgreso) {
      onProgreso(42, esVideo ? 'Emparejando cuadros consecutivos del video…' : 'Buscando coincidencias entre fotos…');
    }
    const r2 = await correrEtapa(colmapBin, subcomandoMatch, argsMatch, {
      ref,
      onLog,
      timeoutMs: 360 * 60 * 1000,
    });
    allLogs.push(...r2.log);

    chequearCancelado();
    chequearTimeout('mapper');
    if (onProgreso) onProgreso(55, 'Reconstruyendo geometría 3D…');
    const r3 = await correrEtapa(colmapBin, 'mapper', [
      '--database_path', dbPath,
      '--image_path', imagePath,
      '--output_path', sparsePath,
      '--Mapper.min_model_size', '2',
      '--Mapper.init_min_num_inliers', '15',
      '--Mapper.ba_global_max_num_iterations', '30',
    ], { ref, onLog, timeoutMs: 180 * 60 * 1000 }); 
    allLogs.push(...r3.log);

    const imagenesRegistradas = r3.log.filter((l) => /Registering image #/.test(l)).length;
    logger.info(`[colmap] mapper registró ${imagenesRegistradas} imágenes`);

    const mejorModelo = elegirMejorModelo(sparsePath, colmapBin);
    if (!mejorModelo) {
      logger.warn('[colmap] mapper no produjo ningún modelo sparse');
      return { mallaPly: null, log: allLogs, imagenesRegistradas: 0 };
    }

    logger.info(`[colmap] mejor modelo sparse: ${mejorModelo}`);

    chequearCancelado();
    chequearTimeout('exportar');
    if (onProgreso) onProgreso(72, 'Exportando nube de puntos 3D…');
    const plyPath = path.join(workspacePath, 'sparse-points.ply');
    const r4 = await correrEtapa(colmapBin, 'model_converter', [
      '--input_path', mejorModelo,
      '--output_path', plyPath,
      '--output_type', 'PLY',
    ], { ref, onLog, timeoutMs: 5 * 60 * 1000 });
    allLogs.push(...r4.log);

    if (!fs.existsSync(plyPath)) {
      logger.warn('[colmap] model_converter no generó el PLY');
      return { mallaPly: null, log: allLogs, imagenesRegistradas };
    }

    const stats = fs.statSync(plyPath);
    logger.info(`[colmap] PLY sparse exportado: ${stats.size} bytes (${imagenesRegistradas} imágenes registradas)`);

    return { mallaPly: plyPath, modeloSparse: mejorModelo, log: allLogs, imagenesRegistradas };
  })();

  return { promesa, detener };
}
