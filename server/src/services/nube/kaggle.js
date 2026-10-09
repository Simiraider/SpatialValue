
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../utils/logger.js';

function ejecutar(bin, args, { cwd, timeoutMs = 20 * 60 * 1000, env } = {}) {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let terminado = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          if (proc.exitCode === null) proc.kill('SIGKILL');
        }, timeoutMs)
      : null;

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (e) => {
      if (terminado) return;
      terminado = true;
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(e.message) });
    });
    proc.on('close', (code) => {
      if (terminado) return;
      terminado = true;
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export function kaggleDisponible(config) {
  if (config.kaggle?.apiToken) return true;
  if (config.kaggle?.username && config.kaggle?.key) return true;
  const dir = process.env.KAGGLE_CONFIG_DIR
    || path.join(process.env.HOME || process.env.USERPROFILE || '', '.kaggle');
  try {
    return fs.existsSync(path.join(dir, 'kaggle.json')) || fs.existsSync(path.join(dir, 'access_token'));
  } catch {
    return false;
  }
}

function entornoKaggle(config) {
  const env = {};
  if (config.kaggle?.apiToken) env.KAGGLE_API_TOKEN = config.kaggle.apiToken;
  if (config.kaggle?.username && config.kaggle?.key) {
    env.KAGGLE_USERNAME = config.kaggle.username;
    env.KAGGLE_KEY = config.kaggle.key;
  }
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const localBin = home ? path.join(home, '.local', 'bin') : '';
  if (localBin && fs.existsSync(localBin)) {
    const sep = process.platform === 'win32' ? ';' : ':';
    const actual = process.env.PATH || '';
    if (!actual.split(sep).includes(localBin)) env.PATH = `${localBin}${sep}${actual}`;
  }
  return env;
}

export async function lanzarKernel(config, { carpetaKernel, carpetaDataset, kernelId, datasetSlug }) {
  const bin = config.kaggle?.bin || 'kaggle';
  const env = entornoKaggle(config);

  if (datasetSlug && carpetaDataset) {
    const meta = {
      title: `spatial-value-input-${Date.now()}`,
      id: datasetSlug,
      licenses: [{ name: 'other' }],
    };
    fs.writeFileSync(path.join(carpetaDataset, 'dataset-metadata.json'), JSON.stringify(meta));
    const crear = await ejecutar(bin, ['datasets', 'create', '-p', carpetaDataset, '--dir-mode=zip'], { env });
    const subir = crear.code === 0 ? crear : await ejecutar(
      bin,
      ['datasets', 'version', '-p', carpetaDataset, '-m', 'input', '--dir-mode=zip'],
      { env }
    );
    if (subir.code !== 0) {
      return { ok: false, detalle: `dataset: ${subir.stderr.slice(-400)}` };
    }
  }

  const push = await ejecutar(bin, ['kernels', 'push', '-p', carpetaKernel], { env });
  if (push.code !== 0) {
    return { ok: false, detalle: `push: ${push.stderr.slice(-400)}` };
  }
  return { ok: true, detalle: push.stdout.slice(-300) };
}

export async function estadoKernel(config, kernelId) {
  const bin = config.kaggle?.bin || 'kaggle';
  const r = await ejecutar(bin, ['kernels', 'status', kernelId], {
    env: entornoKaggle(config),
    timeoutMs: 60 * 1000,
  });
  const texto = `${r.stdout} ${r.stderr}`.toLowerCase();
  if (texto.includes('complete')) return 'complete';
  if (texto.includes('error') || texto.includes('failed')) return 'error';
  if (texto.includes('running')) return 'running';
  if (texto.includes('queued')) return 'queued';
  return 'unknown';
}

export async function bajarSalida(config, kernelId, destinoDir) {
  const bin = config.kaggle?.bin || 'kaggle';
  fs.mkdirSync(destinoDir, { recursive: true });

  const patron = '.*\\.(glb|json)$';
  let ultimo = { code: -1, stderr: '' };
  for (let intento = 1; intento <= 3; intento++) {
    const r = await ejecutar(
      bin,
      ['kernels', 'output', kernelId, '-p', destinoDir, '-o', '--file-pattern', patron],
      { env: entornoKaggle(config), timeoutMs: 20 * 60 * 1000 }
    );
    if (r.code === 0) return { ok: true, detalle: destinoDir };
    ultimo = r;
    await new Promise((res) => setTimeout(res, 5000 * intento));
  }
  return { ok: false, detalle: (ultimo.stderr || '').slice(-400) };
}

export async function esperarKernel(config, kernelId, destinoDir, { timeoutMs, intervaloMs = 20000 } = {}) {
  const t0 = Date.now();
  const limite = timeoutMs || 90 * 60 * 1000;
  while (Date.now() - t0 < limite) {
    const estado = await estadoKernel(config, kernelId);
    logger.info(`[nube] kernel ${kernelId}: ${estado}`);
    if (estado === 'complete') {
      const descarga = await bajarSalida(config, kernelId, destinoDir);
      if (!descarga.ok) return { estado: 'error_descarga', detalle: descarga.detalle };
      const glb = path.join(destinoDir, 'modelo.glb');
      if (!fs.existsSync(glb)) return { estado: 'error_sin_glb' };
      return { estado: 'listo', glb };
    }
    if (estado === 'error') return { estado: 'error_kernel' };
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
  return { estado: 'timeout' };
}
