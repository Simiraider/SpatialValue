/**
 * Ejecución de COLMAP (structure-from-motion) por etapas.
 *
 * Pipeline:
 *   1. feature_extractor   – detecta SIFT features en cada imagen
 *   2. exhaustive_matcher   – busca correspondencias entre todos los pares
 *   3. mapper               – reconstrucción sparse (SfM incremental)
 *   4. model_converter      – exporta nube de puntos a PLY
 *
 * A diferencia del monolítico `automatic_reconstructor`, este pipeline:
 *   - Usa min_model_size=2 (no 10) → acepta reconstrucciones parciales
 *   - Omite la fase densa (requiere GPU CUDA no disponible en este entorno)
 *   - Da progreso granular por etapa
 *   - Permite debuggear cada paso por separado
 *
 * El resultado es un PLY con la nube de puntos 3D coloreada.
 * mesh.js lo convierte a .glb (triangulando la nube si no hay caras).
 *
 * Devuelve { promesa, detener }: `detener()` mata el proceso hijo en vuelo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

const CALIDAD_SIFT = {
  rapida:      { maxImageSize: 1200, maxFeatures: 4096 },
  equilibrada: { maxImageSize: 1600, maxFeatures: 8192 },
  alta:        { maxImageSize: 2400, maxFeatures: 16384 },
  auto:        { maxImageSize: 1600, maxFeatures: 8192 },
};

/** ¿La salida parece de COLMAP? (`colmap help` imprime "COLMAP x.y.z ..."). */
export function salidaPareceColmap(salida) {
  return /COLMAP/i.test(String(salida || ''));
}

export function colmapDisponible(colmapBin) {
  // COLMAP >= 3.11 no reconoce `--version` (usa `colmap help`, que imprime
  // "COLMAP x.y.z" en stdout y termina con 0). `--version` queda como respaldo
  // para versiones viejas. Detección por contenido real (no solo exit code)
  // para no confundir binarios que responden 0 a cualquier subcomando.
  try {
    const help = spawnSync(colmapBin, ['help'], { encoding: 'utf8', timeout: 10000 });
    if (salidaPareceColmap(help.stdout) || salidaPareceColmap(help.stderr)) return true;
    const version = spawnSync(colmapBin, ['--version'], { encoding: 'utf8', timeout: 10000 });
    return salidaPareceColmap(version.stdout) || salidaPareceColmap(version.stderr);
  } catch {
    return false;
  }
}

// ── Ejecución de subcomandos ──────────────────────────────────────────────────

/**
 * Ejecuta un subcomando de COLMAP como proceso hijo.
 * @param {string} colmapBin
 * @param {string} subcomando  p.ej. 'feature_extractor'
 * @param {string[]} args      argumentos del subcomando
 * @param {object} opts
 * @param {{proc: ChildProcess|null}} opts.ref  referencia mutable al proceso (para kill)
 * @param {(m:string)=>void} [opts.onLog]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{log: string[]}>}
 */
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

// ── Selección del mejor modelo sparse ─────────────────────────────────────────

/**
 * Elige el modelo sparse con más puntos 3D reconstruidos.
 * COLMAP puede generar múltiples sub-modelos si el grafo de matching está
 * fragmentado; elegimos el más grande (más puntos = mejor reconstrucción).
 */
export function elegirMejorModelo(sparsePath) {
  if (!fs.existsSync(sparsePath)) return null;

  const modelos = fs.readdirSync(sparsePath)
    .filter((d) => /^\d+$/.test(d) && fs.statSync(path.join(sparsePath, d)).isDirectory());

  if (!modelos.length) return null;

  // El modelo con el archivo points3D.bin más grande tiene más puntos 3D.
  let mejor = null;
  let mejorTam = -1;
  for (const m of modelos) {
    const pts = path.join(sparsePath, m, 'points3D.bin');
    try {
      const tam = fs.statSync(pts).size;
      if (tam > mejorTam) {
        mejorTam = tam;
        mejor = path.join(sparsePath, m);
      }
    } catch {
      // Sin points3D.bin → modelo vacío, ignorar
    }
  }

  return mejor;
}

// ── Pipeline principal ────────────────────────────────────────────────────────

/**
 * @param {string} colmapBin
 * @param {object} opciones
 * @param {string} opciones.imagePath
 * @param {string} opciones.workspacePath
 * @param {string} [opciones.calidad]
 * @param {(p:number, m:string)=>void} [opciones.onProgreso]
 * @param {(m:string)=>void} [opciones.onLog]
 * @param {number} [opciones.timeoutMs]
 * @returns {{ promesa: Promise<{ mallaPly: string|null, log: string[], imagenesRegistradas?: number }>, detener: () => void }}
 */
export function ejecutarColmap(
  colmapBin,
  { imagePath, workspacePath, calidad = 'equilibrada', onLog, onProgreso, timeoutMs = 3 * 3600 * 1000 }
) {
  const ref = { proc: null };
  let cancelado = false;

  const detener = () => {
    cancelado = true;
    if (ref.proc && ref.proc.exitCode === null) {
      try { ref.proc.kill('SIGKILL'); } catch { /* ya terminó */ }
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

    // ── Etapa 1: Feature extraction ───────────────────────────────────────
    chequearCancelado();
    if (onProgreso) onProgreso(30, 'Extrayendo características de las fotos (SIFT)…');
    const r1 = await correrEtapa(colmapBin, 'feature_extractor', [
      '--database_path', dbPath,
      '--image_path', imagePath,
      '--ImageReader.single_camera', '1',
      '--SiftExtraction.max_image_size', String(sift.maxImageSize),
      '--SiftExtraction.max_num_features', String(sift.maxFeatures),
    ], { ref, onLog, timeoutMs: 180 * 60 * 1000 }); // 3h; video denso puede tardar
    allLogs.push(...r1.log);

    // ── Etapa 2: Exhaustive matching ──────────────────────────────────────
    chequearCancelado();
    chequearTimeout('matching');
    if (onProgreso) onProgreso(42, 'Buscando coincidencias entre fotos…');
    const r2 = await correrEtapa(colmapBin, 'exhaustive_matcher', [
      '--database_path', dbPath,
      '--SiftMatching.guided_matching', '1',
    ], { ref, onLog, timeoutMs: 360 * 60 * 1000 }); // 6h; el matcher exhaustive puede ser muy lento en WSL sin GPU
    allLogs.push(...r2.log);

    // ── Etapa 3: Mapper (SfM incremental) ─────────────────────────────────
    // min_model_size=2 es EL cambio crítico: automatic_reconstructor usaba 10,
    // descartando reconstrucciones válidas pero parciales de fotos de celular.
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
    ], { ref, onLog, timeoutMs: 180 * 60 * 1000 }); // 3h
    allLogs.push(...r3.log);

    // Contar imágenes registradas desde el log del mapper
    const imagenesRegistradas = r3.log.filter((l) => /Registering image #/.test(l)).length;
    logger.info(`[colmap] mapper registró ${imagenesRegistradas} imágenes`);

    // ── Elegir mejor modelo sparse ────────────────────────────────────────
    const mejorModelo = elegirMejorModelo(sparsePath);
    if (!mejorModelo) {
      logger.warn('[colmap] mapper no produjo ningún modelo sparse');
      return { mallaPly: null, log: allLogs, imagenesRegistradas: 0 };
    }

    logger.info(`[colmap] mejor modelo sparse: ${mejorModelo}`);

    // ── Etapa 4: Exportar a PLY ───────────────────────────────────────────
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

    return { mallaPly: plyPath, log: allLogs, imagenesRegistradas };
  })();

  return { promesa, detener };
}
