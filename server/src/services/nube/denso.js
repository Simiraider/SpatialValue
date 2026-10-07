
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';
import { kaggleDisponible, lanzarKernel, esperarKernel } from './kaggle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_REPO = path.resolve(__dirname, '../../../../');
const PLANTILLA_KERNEL = path.join(RAIZ_REPO, 'kaggle', 'dense-colmap');

function copiarDir(origen, destino) {
  fs.mkdirSync(destino, { recursive: true });
  for (const entrada of fs.readdirSync(origen, { withFileTypes: true })) {
    const de = path.join(origen, entrada.name);
    const a = path.join(destino, entrada.name);
    if (entrada.isDirectory()) copiarDir(de, a);
    else fs.copyFileSync(de, a);
  }
}

function reunirImagenes(inputDir) {
  const exts = /\.(jpe?g|png|webp|heic|heif|avif)$/i;
  const encontradas = [];
  const recorrer = (dir) => {
    let entradas = [];
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (exts.test(e.name)) encontradas.push(p);
    }
  };
  recorrer(inputDir);
  return encontradas;
}

export async function densificarEnNube(config, { inputDir, sparseModelPath, jobId }) {
  if (!config.dense?.habilitado) return null;
  if (!kaggleDisponible(config)) {
    logger.warn('[nube] Kaggle no configurado (faltan KAGGLE_USERNAME/KAGGLE_KEY o ~/.kaggle/kaggle.json)');
    return null;
  }
  if (!config.dense.kernelId) {
    logger.warn('[nube] falta GEMELO_KAGGLE_KERNEL_ID');
    return null;
  }
  if (!fs.existsSync(PLANTILLA_KERNEL)) {
    logger.warn('[nube] no existe la plantilla del kernel en kaggle/dense-colmap');
    return null;
  }

  const trabajoDir = path.join(config.dataDir, 'nube', jobId);
  const carpetaKernel = path.join(trabajoDir, 'kernel');
  const carpetaDataset = path.join(trabajoDir, 'dataset', 'images');
  const carpetaSalida = path.join(trabajoDir, 'salida');

  try {
    fs.rmSync(trabajoDir, { recursive: true, force: true });
    copiarDir(PLANTILLA_KERNEL, carpetaKernel);

    const metaPath = path.join(carpetaKernel, 'kernel-metadata.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.id = config.dense.kernelId;
    meta.is_private = true;
    const slug = config.dense.datasetSlug
      || (config.kaggle.username ? `${config.kaggle.username}/spatial-value-input` : '');
    if (!slug) {
      logger.warn('[nube] falta GEMELO_KAGGLE_DATASET (necesario con el token nuevo de Kaggle)');
      return null;
    }
    meta.dataset_sources = [slug];
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    const imagenes = reunirImagenes(inputDir);
    if (imagenes.length < 3) {
      logger.warn(`[nube] muy pocas imágenes para densificar (${imagenes.length})`);
      return null;
    }
    fs.mkdirSync(carpetaDataset, { recursive: true });
    for (const img of imagenes) {
      fs.copyFileSync(img, path.join(carpetaDataset, path.basename(img)));
    }
    if (sparseModelPath && fs.existsSync(sparseModelPath)) {
      copiarDir(sparseModelPath, path.join(trabajoDir, 'dataset', 'sparse'));
    }

    logger.info(`[nube] lanzando Kaggle (${imagenes.length} imágenes)…`);
    const lanzado = await lanzarKernel(config, {
      carpetaKernel,
      carpetaDataset: path.join(trabajoDir, 'dataset'),
      kernelId: config.dense.kernelId,
      datasetSlug: slug,
    });
    if (!lanzado.ok) {
      logger.warn(`[nube] no se pudo lanzar el kernel: ${lanzado.detalle}`);
      return null;
    }

    const resultado = await esperarKernel(config, config.dense.kernelId, carpetaSalida, {
      timeoutMs: config.dense.timeoutMs,
    });
    if (resultado.estado !== 'listo' || !resultado.glb) {
      logger.warn(`[nube] densificado no completó: ${resultado.estado} ${resultado.detalle || ''}`);
      return null;
    }
    return { glb: resultado.glb };
  } catch (e) {
    logger.warn(`[nube] error inesperado: ${e.message}`);
    return null;
  }
}
