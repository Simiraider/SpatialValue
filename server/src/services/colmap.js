/**
 * Ejecución de COLMAP (structure-from-motion + multi-view stereo).
 *
 * Usa `colmap automatic_reconstructor`, que encadena: extracción de features,
 * matching, registro de cámaras (sparse), reconstrucción densa, fusión y mallado.
 * El resultado principal es dense/0/meshed-poisson.ply (malla).
 *
 * Devuelve { promesa, detener }: `detener()` mata el proceso hijo para no dejar
 * procesos huérfanos cuando el usuario cancela el trabajo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

const CALIDAD = {
  rapida: 'low',
  equilibrada: 'medium',
  alta: 'high',
  auto: 'medium',
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

function mallaPrincipal(workspacePath) {
  const candidatos = [
    path.join(workspacePath, 'dense', '0', 'meshed-poisson.ply'),
    path.join(workspacePath, 'dense', '0', 'meshed-delaunay.ply'),
    path.join(workspacePath, 'dense', '0', 'fused.ply'),
  ];
  return candidatos.find((c) => fs.existsSync(c)) || null;
}

/** Heurística de progreso según líneas típicas del log de COLMAP. */
function progresoPorLinea(linea, progresoActual) {
  const l = linea.toLowerCase();
  if (l.includes('registering image')) return Math.max(progresoActual, 40);
  if (l.includes('dense reconstruction')) return Math.max(progresoActual, 60);
  if (l.includes('fusion')) return Math.max(progresoActual, 72);
  if (l.includes('poisson')) return Math.max(progresoActual, 80);
  if (l.includes('delaunay')) return Math.max(progresoActual, 80);
  return progresoActual;
}

/**
 * @param {object} opciones
 * @param {string} opciones.imagePath
 * @param {string} opciones.workspacePath
 * @param {string} [opciones.calidad]
 * @param {(p:number, m:string)=>void} [opciones.onProgreso]
 * @param {(m:string)=>void} [opciones.onLog]
 * @param {number} [opciones.timeoutMs]
 * @returns {{ promesa: Promise<{ mallaPly: string|null, log: string[] }>, detener: () => void }}
 */
export function ejecutarColmap(
  colmapBin,
  { imagePath, workspacePath, calidad = 'equilibrada', onLog, onProgreso, timeoutMs = 3 * 3600 * 1000 }
) {
  let proc = null;
  let timer = null;
  let detener = () => {};

  const promesa = new Promise((resolve, reject) => {
    if (!colmapDisponible(colmapBin)) {
      reject(new Error('COLMAP no está instalado en el worker (GEMELO_MODO=colmap o auto sin binario).'));
      return;
    }
    fs.mkdirSync(workspacePath, { recursive: true });
    const args = [
      'automatic_reconstructor',
      '--workspace_path', workspacePath,
      '--image_path', imagePath,
      '--data_type', 'individual',
      '--quality', CALIDAD[calidad] || CALIDAD.equilibrada,
      '--use_gpu', '0',
    ];
    logger.info(`[colmap] ${colmapBin} ${args.join(' ')}`);
    proc = spawn(colmapBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const log = [];
    let progreso = 30;
    let stderr = '';

    timer = setTimeout(() => {
      if (proc && proc.exitCode === null) proc.kill('SIGKILL');
      reject(new Error(`COLMAP superó el tiempo máximo (${Math.round(timeoutMs / 60000)} min).`));
    }, timeoutMs);

    proc.stderr.on('data', (d) => {
      const line = d.toString().trim();
      if (!line) return;
      stderr = stderr + line.slice(-2000) + '\n';
      if (log.length < 200) log.push(line);
      const nuevo = progresoPorLinea(line, progreso);
      if (nuevo !== progreso) {
        progreso = nuevo;
        if (onProgreso) onProgreso(progreso, line.slice(0, 140));
      }
      if (onLog) onLog(line.slice(0, 300));
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`COLMAP terminó con código ${code}. ${stderr.slice(-400)}`));
        return;
      }
      const malla = mallaPrincipal(workspacePath);
      if (!malla) {
        logger.warn('[colmap] terminó sin malla: se usará el simulador como respaldo');
      }
      resolve({ mallaPly: malla, log });
    });
  });

  detener = () => {
    clearTimeout(timer);
    if (proc && proc.exitCode === null) proc.kill('SIGKILL');
  };

  return { promesa, detener };
}
