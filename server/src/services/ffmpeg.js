
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

export function ffmpegDisponible(ffmpegBin) {
  try {
    const r = spawnSync(ffmpegBin, ['-version'], { stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
}

export function dimensionesVideo(ffmpegBin, videoPath) {
  try {
    const r = spawnSync(ffmpegBin, ['-i', videoPath], { encoding: 'utf8', timeout: 15000 });
    const salida = r.stderr || '';
    const m = salida.match(/(\d{2,5})x(\d{2,5})/);
    const d = salida.match(/Duration:\s*(\d+):(\d{2}):(\d{2})[.,](\d{2})/);
    const dur = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) + Number(d[4]) / 100 : null;
    if (m) return { w: Number(m[1]), h: Number(m[2]), dur };
  } catch {
  }
  return null;
}

function comandoFrames(videoPath, outDir, { fps, maxFrames }) {
  return [
    '-y',
    '-i', videoPath,
    '-vf', `fps=${fps}`,
    '-frames:v', String(maxFrames),
    '-q:v', '2',
    path.join(outDir, 'frame_%04d.jpg'),
  ];
}

export function extraerFrames(ffmpegBin, videoPath, outDir, { fps = 1, maxFrames = 100, duracion = null, onLog } = {}) {
  let proc = null;
  let detener = () => {};

  const promesa = new Promise((resolve, reject) => {
    if (!ffmpegDisponible(ffmpegBin)) {
      reject(new Error('ffmpeg no está instalado en el worker. Instalalo o subí fotos directamente.'));
      return;
    }
    fs.mkdirSync(outDir, { recursive: true });

    const ejecutar = (args) =>
      new Promise((res, rej) => {
        logger.info(`[ffmpeg] ${ffmpegBin} ${args.join(' ')}`);
        proc = spawn(ffmpegBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', (d) => {
          const line = d.toString();
          stderr += line;
          if (onLog) onLog(line);
        });
        proc.on('error', (err) => rej(err));
        proc.on('close', (code) => {
          let frames = 0;
          try {
            frames = fs.readdirSync(outDir).filter((f) => /\.jpe?g$/i.test(f)).length;
          } catch {
            frames = 0;
          }
          res({ code, frames, stderr });
        });
      });

    (async () => {
      try {
        const uniforme = duracion && duracion > 0 ? Math.min(5, maxFrames / duracion) : null;
        const pasos = [
          uniforme
            ? {
                fps: uniforme.toFixed(3),
                etiqueta: `muestreo uniforme ${uniforme.toFixed(2)} fps (1 cuadro cada ${(1 / uniforme).toFixed(1)} s)`,
              }
            : { fps: '1/3', etiqueta: '1 cuadro cada 3 s' },
          { fps, etiqueta: `fps=${fps}` },
        ];
        for (const paso of pasos) {
          const r = await ejecutar(comandoFrames(videoPath, outDir, { fps: paso.fps, maxFrames }));
          if (r.code !== 0) throw new Error(`ffmpeg terminó con código ${r.code}: ${r.stderr.slice(-400)}`);
          logger.info(`[ffmpeg] ${r.frames} cuadros extraídos (${paso.etiqueta})`);
          if (r.frames >= 5) {
            resolve(r.frames);
            return;
          }
          if (paso === pasos[pasos.length - 1]) {
            if (r.frames > 0) {
              resolve(r.frames);
              return;
            }
            throw new Error('ffmpeg no produjo cuadros: revisá que el video tenga contenido visible.');
          }
          logger.warn(`[ffmpeg] solo ${r.frames} cuadros espaciados; reextrayendo con ${pasos[pasos.length - 1].etiqueta}`);
          try {
            fs.readdirSync(outDir).forEach((f) => {
              if (/\.jpe?g$/i.test(f)) fs.unlinkSync(path.join(outDir, f));
            });
          } catch {
          }
        }
      } catch (e) {
        reject(e);
      }
    })();
  });

  detener = () => {
    if (proc && proc.exitCode === null) proc.kill('SIGKILL');
  };

  return { promesa, detener };
}
