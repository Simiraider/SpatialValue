/**
 * Pipeline de reconstrucción 3D.
 *
 * Flujo por trabajo:
 *   recibiendo → extrayendo_frames (solo video) → reconstruyendo → convirtiendo → listo | error
 *
 * Las FOTOS NUNCA se guardan: se borran del workspace al terminar (o al fallar).
 * El modelo .glb queda en el filesystem local hasta que expira el TTL.
 *
 * `detener(id)` mata los procesos hijos (ffmpeg/COLMAP) en vuelo para que
 * cancelar un trabajo no deje procesos huérfanos.
 */

import fs from 'node:fs';
import path from 'node:path';
import { extraerFrames, dimensionesVideo } from './ffmpeg.js';
import { colmapDisponible, ejecutarColmap } from './colmap.js';
import { convertirMalla } from './mesh.js';
import { generarModeloDemo } from './simulador.js';
import { guardarModelo } from './storage.js';
import { logger } from '../utils/logger.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function crearPipeline({ config, estado }) {
  const cola = [];
  const procesos = new Map(); // jobId → { promesa, detener } de procesos hijos
  const cancelados = new Set(); // jobId → pedido de cancelación
  let procesando = false;

  function encolar(job) {
    cola.push(job);
    void despachar();
  }

  async function despachar() {
    if (procesando) return;
    procesando = true;
    while (cola.length) {
      const job = cola.shift();
      try {
        await procesar(job);
      } catch (e) {
        logger.error(`[pipeline] error inesperado en ${job.id}:`, e.message);
      } finally {
        cancelados.delete(job.id);
        procesos.delete(job.id);
      }
    }
    procesando = false;
  }

  /** Pide cancelar un trabajo: mata procesos hijos y marca la cancelación. */
  function detener(jobId) {
    cancelados.add(jobId);
    const ctl = procesos.get(jobId);
    if (ctl?.detener) {
      try {
        ctl.detener();
      } catch {
        /* ya terminó */
      }
    }
  }

  const limpiarFotos = (job) => {
    if (config.keepFotos) return; // debug: conservar fotos/frames para diagnóstico
    try {
      fs.rmSync(path.join(estado.dirDe(job.id), 'input'), { recursive: true, force: true });
    } catch {
      /* sin fotos */
    }
  };

  const asegurarNoCancelado = (job) => {
    if (cancelados.has(job.id)) {
      throw new Error('Trabajo cancelado por el usuario.');
    }
  };

  async function procesar(job) {
    try {
      await procesarInterno(job);
    } catch (e) {
      // Cualquier falla (ffmpeg ausente, COLMAP, conversión, cancelación) debe:
      //  1) pasar el trabajo a estado 'error' (si no quedaba trabado en procesando)
      //  2) borrar SIEMPRE las fotos subidas (no se guardan, ni siquiera al fallar)
      const mensaje = e instanceof Error ? e.message : String(e);
      limpiarFotos(job);
      estado.actualizar(job.id, {
        estado: 'error',
        etapa: 'error',
        error: mensaje,
        mensaje: 'El procesamiento falló.',
      });
      logger.error(`[pipeline] trabajo ${job.id} en error: ${mensaje}`);
    }
  }

  async function procesarInterno(job) {
    const dirJob = estado.dirDe(job.id);
    const inputDir = path.join(dirJob, 'input');
    const outputDir = path.join(dirJob, 'output');
    fs.mkdirSync(outputDir, { recursive: true });

    let nFotos = job.nFotos || 0;

    // 1) Recepción ────────────────────────────────────────────────────────────
    estado.actualizar(job.id, { estado: 'recibiendo', etapa: 'recibiendo', progreso: 5, mensaje: 'Recibiendo fotos…' });

    // 2) Video → frames (los frames de video tampoco se guardan) ──────────────
    if (job.esVideo) {
      estado.actualizar(job.id, {
        estado: 'procesando',
        etapa: 'extrayendo_frames',
        progreso: 10,
        mensaje: 'Extrayendo cuadros del video (ffmpeg, 1 fps)…',
      });
      const video = fs.readdirSync(inputDir).find((f) => /\.(mp4|mov|m4v|webm)$/i.test(f));
      if (!video) throw new Error('No se encontró el video subido.');

      // Control de calidad preventivo: un video de baja resolución (p.ej. re-comprimido
      // por WhatsApp o redes sociales) no tiene features suficientes para fotogrametría.
      const dim = dimensionesVideo(config.ffmpegBin, path.join(inputDir, video));
      if (dim && Math.min(dim.w, dim.h) < 600) {
        throw new Error(
          `El video es de muy baja resolución (${dim.w}×${dim.h}px). ` +
            'Grabá el recorrido con la cámara en calidad máxima (1080p o superior) y no lo ' +
            'envíes por WhatsApp ni redes sociales: comprimen el video y se pierden los ' +
            'detalles necesarios para reconstruir el 3D.'
        );
      }
      const framesDir = path.join(inputDir, 'frames');
      const ctl = extraerFrames(config.ffmpegBin, path.join(inputDir, video), framesDir, {
        fps: 1,
        maxFrames: config.maxFotos,
        onLog: (linea) =>
          estado.actualizar(job.id, { mensaje: `Extrayendo cuadros… (${linea.slice(-60).trim()})` }),
      });
      procesos.set(job.id, ctl);
      try {
        nFotos = await ctl.promesa;
        asegurarNoCancelado(job);
      } finally {
        procesos.delete(job.id);
      }
      estado.actualizar(job.id, { nFotos, mensaje: `${nFotos} cuadros extraídos del video.` });
      try {
        fs.unlinkSync(path.join(inputDir, video)); // el video original no se guarda
      } catch {
        /* ya no existe */
      }
    }

    // 3) Motor de reconstrucción ──────────────────────────────────────────────
    const modo =
      config.modo === 'auto'
        ? colmapDisponible(config.colmapBin)
          ? 'colmap'
          : 'simular'
        : config.modo;

    let glbPath = path.join(outputDir, 'modelo.glb');
    let motor = modo;
    let mensajeExtra = null;
    let resumenColmap = null;

    if (modo === 'colmap') {
      estado.actualizar(job.id, {
        estado: 'procesando',
        etapa: 'reconstruyendo',
        progreso: 30,
        mensaje: 'Ejecutando reconstrucción fotogramétrica (COLMAP)…',
      });
      const ctl = ejecutarColmap(config.colmapBin, {
        imagePath: inputDir,
        workspacePath: path.join(outputDir, 'colmap'),
        calidad: job.opciones?.calidad || 'equilibrada',
        onProgreso: (p, m) => estado.actualizar(job.id, { progreso: Math.min(p, 84), mensaje: m }),
        onLog: (m) => estado.actualizar(job.id, { mensaje: m }),
      });
      procesos.set(job.id, ctl);
      let resultado;
      try {
        resultado = await ctl.promesa;
        asegurarNoCancelado(job);
      } finally {
        procesos.delete(job.id);
      }
      if (resultado.mallaPly) {
        estado.actualizar(job.id, {
          etapa: 'convirtiendo',
          progreso: 86,
          mensaje: 'Convirtiendo la malla a .glb…',
        });
        try {
          const conv = convertirMalla(resultado.mallaPly, glbPath);
          logger.info(`[pipeline] malla convertida: ${conv.vertices} vértices, ${conv.triangulos} triángulos`);
        } catch (e) {
          // La malla de COLMAP no se pudo convertir (p.ej. era solo una nube de
          // puntos): en vez de fallar el trabajo, se usa el simulador como respaldo.
          logger.warn(`[pipeline] conversión de malla falló (${e.message}); respaldo con simulador`);
          motor = 'simular';
          mensajeExtra = 'La malla de COLMAP no se pudo convertir; se usó un modelo de demostración.';
        }
      } else {
        // COLMAP no produjo malla → respaldo con simulador
        logger.warn('[pipeline] COLMAP sin malla; respaldo con simulador');
        motor = 'simular';
        resumenColmap = (resultado.log || []).slice(-60).join('\n').slice(-4000);
        mensajeExtra =
          'COLMAP no encontró suficientes coincidencias entre las fotos para reconstruir la geometría. ' +
          'Cada zona debe verse en ≥3 fotos con solapamiento, o subí un video en cámara lenta recorriendo la propiedad. ' +
          'Se usó un modelo de demostración.';
      }
    }

    if (motor === 'simular') {
      const pasos = [
        [25, 'Generando nube de puntos…'],
        [45, 'Estimando poses de cámara…'],
        [68, 'Construyendo malla…'],
        [84, 'Aplicando textura…'],
      ];
      for (const [p, msg] of pasos) {
        asegurarNoCancelado(job);
        await sleep(config.velocidadSimulacionMs);
        estado.actualizar(job.id, { estado: 'procesando', etapa: 'reconstruyendo', progreso: p, mensaje: msg });
      }
      asegurarNoCancelado(job);
      estado.actualizar(job.id, { etapa: 'convirtiendo', progreso: 90, mensaje: 'Generando modelo .glb…' });
      const res = generarModeloDemo({ seed: job.id, fotos: nFotos, outputDir });
      glbPath = res.archivo;
      logger.info(`[pipeline] modelo demo: ${res.vertices} vértices, ${res.triangulos} triángulos`);
    }

    // 4) Las fotos se borran SIEMPRE ─────────────────────────────────────────
    limpiarFotos(job);

    // 5) Guardar modelo y marcar listo ───────────────────────────────────────
    const storage = await guardarModelo(config, job.id, glbPath);
    const bytes = fs.statSync(glbPath).size;
    const expiraEn = Date.now() + config.ttlMs;
    const cambios = {
      estado: 'listo',
      etapa: 'listo',
      progreso: 100,
      mensaje: mensajeExtra || 'Modelo generado. Disponible por ' + config.ttlHoras + ' h.',
      modeloBytes: bytes,
      modeloStorage: storage.tipo,
      expiraEn,
      motor,
    };
    if (resumenColmap) cambios.logColmap = resumenColmap;
    if (storage.tipo === 'local') {
      cambios.modeloUrl = `/api/jobs/${job.id}/modelo`;
    } else {
      cambios.modeloUrl = storage.url; // URL firmada de S3/B2
    }
    estado.actualizar(job.id, cambios);
    logger.info(`[pipeline] trabajo ${job.id} listo (${bytes} bytes, motor=${motor})`);
  }

  return { encolar, procesar, detener, limpiarFotos };
}
