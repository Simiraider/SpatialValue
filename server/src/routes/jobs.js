/**
 * API REST del worker de gemelos digitales.
 *
 *  POST   /api/jobs             crear trabajo + subir fotos/video (multipart)
 *  GET    /api/jobs/:id         estado y progreso del trabajo
 *  GET    /api/jobs/:id/modelo  descargar el .glb (cuando está listo)
 *  DELETE /api/jobs/:id         cancelar y borrar el trabajo
 *  GET    /api/jobs             listar recientes (requiere token, admin)
 *  GET    /api/healthz          salud del servicio
 */

import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { calidadPorFotos } from '../services/confianza.js';
import { tiempoEstimadoSeg } from '../services/tiempo.js';
import { colmapDisponible } from '../services/colmap.js';
import { ffmpegDisponible } from '../services/ffmpeg.js';
import { logger } from '../utils/logger.js';

const IMAGENES = /\.(jpe?g|png|webp|heic|heif|avif)$/i;
const VIDEOS = /\.(mp4|mov|m4v|webm)$/i;

function parsearOpciones(raw) {
  if (!raw) return { calidad: 'equilibrada' };
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const calidad = ['rapida', 'equilibrada', 'alta', 'auto'].includes(obj?.calidad)
      ? obj.calidad
      : 'equilibrada';
    return { calidad };
  } catch {
    return { calidad: 'equilibrada' };
  }
}

export function crearRouter({ config, estado, pipeline }) {
  const router = Router();

  // Token opcional para endpoints de administración.
  const exigeToken = (req, res, next) => {
    if (!config.workerToken) return next();
    if (req.get('X-Worker-Token') === config.workerToken) return next();
    return res.status(401).json({ error: 'Token inválido' });
  };

  // Límite de creación de trabajos por IP (anti abuso, simple).
  const limites = new Map();
  const limitador = (req, res, next) => {
    if (config.rateLimit.max <= 0) return next();
    const ip = req.ip || 'anon';
    const ahora = Date.now();
    const rec = limites.get(ip) || { contador: 0, ventana: ahora };
    if (ahora - rec.ventana > config.rateLimit.windowMs) {
      rec.contador = 0;
      rec.ventana = ahora;
    }
    rec.contador++;
    if (rec.contador > config.rateLimit.max) {
      return res.status(429).json({
        error: 'Demasiados trabajos creados desde esta IP. Esperá unos minutos.',
      });
    }
    limites.set(ip, rec);
    next();
  };

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        if (!req.uploadDir) req.uploadDir = estado.crearDirTmp();
        cb(null, req.uploadDir);
      },
      filename: (req, file, cb) => {
        const limpio = file.originalname.replace(/[^\w.\-]/g, '_').slice(-80);
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${limpio}`);
      },
    }),
    limits: {
      fileSize: config.maxVideoMb * 1024 * 1024,
      files: config.maxFotos,
      fields: 10,
      fieldSize: 64 * 1024,
    },
  });

  // ── Crear trabajo ──────────────────────────────────────────────────────────
  router.post('/jobs', limitador, upload.array('fotos', config.maxFotos), (req, res) => {
    try {
      const archivos = req.files || [];
      if (!archivos.length) {
        return res.status(400).json({ error: 'No se recibieron archivos. Subí fotos (≥' + config.minFotos + ') o un video.' });
      }

      const fotos = archivos.filter((f) => IMAGENES.test(f.originalname));
      const videos = archivos.filter((f) => VIDEOS.test(f.originalname));
      const otros = archivos.filter((f) => !IMAGENES.test(f.originalname) && !VIDEOS.test(f.originalname));
      if (otros.length) {
        return res.status(400).json({ error: `Formato no soportado: ${otros.map((o) => o.originalname).join(', ')}` });
      }
      if (videos.length > 1) {
        return res.status(400).json({ error: 'Solo se admite un video por trabajo.' });
      }
      const esVideo = videos.length === 1;
      if (!esVideo && fotos.length < config.minFotos) {
        return res.status(400).json({ error: `Se necesitan al menos ${config.minFotos} fotos (o subir un video).` });
      }

      const opciones = parsearOpciones(req.body?.opciones);
      const totalFotos = esVideo ? 1 : fotos.length;
      const calidad = calidadPorFotos(esVideo ? config.minFotos : fotos.length);
      const modoEstimacion = config.modo === 'simular' ? 'simular' : 'colmap';
      const tiempoSeg = tiempoEstimadoSeg(totalFotos, { esVideo, modo: modoEstimacion });

      const job = estado.crear({
        titulo: String(req.body?.titulo || '').slice(0, 200) || 'Gemelo digital',
        idUsuario: String(req.body?.id_usuario || req.body?.usuario_id || '').slice(0, 100) || null,
        idPublicacion: req.body?.id_publicacion ? String(req.body.id_publicacion).slice(0, 40) : null,
        totalFotos,
        nFotos: totalFotos,
        esVideo,
        calidadEstimada: calidad.clave,
        tiempoEstimadoSeg: tiempoSeg,
        opciones,
        modeloStorage: null,
      });

      // Mover los archivos del directorio temporal al workspace del trabajo.
      const inputDir = path.join(estado.dirDe(job.id), 'input');
      fs.mkdirSync(inputDir, { recursive: true });
      for (const f of archivos) {
        const destino = path.join(inputDir, f.filename || path.basename(f.path));
        fs.renameSync(f.path, destino);
      }
      try {
        fs.rmdirSync(req.uploadDir);
      } catch {
        /* no vacío */
      }

      pipeline.encolar(job);
      logger.info(`[api] trabajo ${job.id} creado (${esVideo ? 'video' : fotos.length + ' fotos'})`);

      return res.status(201).json({
        id: job.id,
        estado: job.estado,
        totalFotos,
        esVideo,
        calidadEstimada: calidad.clave,
        tiempoEstimadoSeg: tiempoSeg,
        mensaje: 'Trabajo creado. Procesando…',
      });
    } catch (e) {
      logger.error('[api] error al crear trabajo:', e.message);
      return res.status(500).json({ error: 'No se pudo crear el trabajo', detalle: e.message });
    }
  });

  // ── Estado del trabajo ─────────────────────────────────────────────────────
  router.get('/jobs/:id', (req, res) => {
    const job = estado.publico(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Trabajo no encontrado (puede haber expirado).' });
    }
    res.json(job);
  });

  // ── Descarga del modelo ────────────────────────────────────────────────────
  router.get('/jobs/:id/modelo', async (req, res) => {
    const job = estado.obtener(req.params.id);
    if (!job) return res.status(404).json({ error: 'Trabajo no encontrado.' });
    if (job.estado !== 'listo') {
      return res.status(409).json({ error: 'El modelo aún no está listo.', estado: job.estado });
    }
    if (job.modeloStorage === 's3') {
      // URL firmada ya guardada en el trabajo.
      return res.redirect(job.modeloUrl);
    }
    const glbPath = path.join(estado.dirDe(job.id), 'output', 'modelo.glb');
    if (!fs.existsSync(glbPath)) {
      return res.status(404).json({ error: 'El archivo del modelo ya no existe.' });
    }
    const descargar = req.query.download === '1';
    res.set('Content-Type', 'model/gltf-binary');
    res.set(
      'Content-Disposition',
      `${descargar ? 'attachment' : 'inline'}; filename="gemelo-${job.id}.glb"`
    );
    res.set('Content-Length', String(job.modeloBytes || fs.statSync(glbPath).size));
    fs.createReadStream(glbPath).pipe(res);
  });

  // ── Cancelar / borrar ──────────────────────────────────────────────────────
  router.delete('/jobs/:id', (req, res) => {
    // Mata procesos hijos en vuelo (ffmpeg/COLMAP) antes de borrar el workspace.
    pipeline.detener(req.params.id);
    const eliminado = estado.eliminar(req.params.id);
    if (!eliminado) return res.status(404).json({ error: 'Trabajo no encontrado.' });
    res.status(204).end();
  });

  // ── Listar recientes (admin) ───────────────────────────────────────────────
  router.get('/jobs', exigeToken, (req, res) => {
    res.json({ trabajos: estado.listarRecientes(Number(req.query.limite) || 20) });
  });

  // ── Salud ──────────────────────────────────────────────────────────────────
  router.get('/healthz', (req, res) => {
    res.json({
      ok: true,
      servicio: 'spatial-value-gemelo-worker',
      modo: config.modo,
      colmapInstalado: colmapDisponible(config.colmapBin),
      ffmpegInstalado: ffmpegDisponible(config.ffmpegBin),
      minFotos: config.minFotos,
      maxFotos: config.maxFotos,
      ttlHoras: config.ttlHoras,
      trabajosActivos: [...estado.internos.values()].filter((j) => j.estado !== 'listo' && j.estado !== 'error').length,
    });
  });

  return router;
}
