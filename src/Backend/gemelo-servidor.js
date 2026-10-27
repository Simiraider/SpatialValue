import { neon } from '@neondatabase/serverless';
import { unzipSync } from 'fflate';
import { resolverUrlModeloFallback } from '../lib/gemelo.ts';

const API_KIRI = 'https://api.kiriengine.app/api/v1/open';
const API_MAKESPLAT = 'https://api.makesplat.com';
const TTL_ESTADO_MS = 30_000;
const TTL_JOB_MS = 7 * 24 * 3600_000;

const valor = (n) => {
  try {
    if (import.meta && import.meta.env && import.meta.env[n]) return import.meta.env[n];
  } catch {
  }
  return process.env[n] || '';
};

const CONEXION = valor('SpatialValueStorage_DATABASE_URL');
let sql = null;
function db() {
  if (!CONEXION) return null;
  if (!sql) sql = neon(CONEXION);
  return sql;
}

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS gemelo_jobs (
  id TEXT PRIMARY KEY,
  proveedor TEXT,
  proveedor_ref TEXT,
  titulo TEXT,
  id_usuario TEXT,
  id_publicacion TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  etapa TEXT NOT NULL DEFAULT 'recibiendo',
  progreso INTEGER NOT NULL DEFAULT 0,
  mensaje TEXT,
  n_fotos INTEGER NOT NULL DEFAULT 0,
  es_video BOOLEAN NOT NULL DEFAULT false,
  calidad_estimada TEXT,
  modelo_glb BYTEA,
  modelo_bytes INTEGER,
  modelo_url TEXT,
  motor TEXT,
  error TEXT,
  creado_en BIGINT NOT NULL,
  expira_en BIGINT
)`;

let tablaPendiente = null;
async function tabla() {
  const d = db();
  if (!d) throw new Error('Sin base de datos: falta SpatialValueStorage_DATABASE_URL.');
  if (!tablaPendiente) {
    tablaPendiente = d.query(ESQUEMA)
      .then(() => true)
      .catch((e) => {
        tablaPendiente = null;
        throw e;
      });
  }
  return tablaPendiente;
}

export function proveedorConfigurado() {
  if (valor('KIRI_API_KEY')) return 'kiri';
  if (valor('MAKESPLAT_API_KEY')) return 'makesplat';
  return null;
}

const encabezadoKiri = () => ({ Authorization: `Bearer ${valor('KIRI_API_KEY')}` });
const encabezadoMakeSplat = () => ({ Authorization: `Bearer ${valor('MAKESPLAT_API_KEY')}` });

const cacheEstados = new Map();
const enCache = (id) => {
  const c = cacheEstados.get(id);
  return c && Date.now() - c.en < TTL_ESTADO_MS ? c.datos : null;
};
const ponerEnCache = (id, datos) => {
  if (cacheEstados.size > 200) cacheEstados.clear();
  cacheEstados.set(id, { en: Date.now(), datos });
};

const json = (status, cuerpo) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const responder = json;

export function nuevaFila({
  id,
  proveedor,
  proveedorRef = null,
  titulo,
  idUsuario = null,
  idPublicacion = null,
  nFotos = 0,
  esVideo = false,
  motor,
}) {
  const ahora = Date.now();
  return {
    id,
    proveedor,
    proveedor_ref: proveedorRef,
    titulo: titulo || 'Gemelo digital',
    id_usuario: idUsuario,
    id_publicacion: idPublicacion,
    estado: 'procesando',
    etapa: 'recibiendo',
    progreso: 2,
    mensaje: 'Trabajo creado',
    n_fotos: nFotos,
    es_video: esVideo,
    calidad_estimada: null,
    modelo_glb: null,
    modelo_bytes: null,
    modelo_url: null,
    motor,
    error: null,
    creado_en: ahora,
    expira_en: ahora + TTL_JOB_MS,
  };
}

export async function guardarFila(f) {
  await tabla();
  const d = db();
  await d`
    INSERT INTO gemelo_jobs (id, proveedor, proveedor_ref, titulo, id_usuario, id_publicacion,
      estado, etapa, progreso, mensaje, n_fotos, es_video, calidad_estimada,
      modelo_bytes, modelo_url, motor, error, creado_en, expira_en)
    VALUES (${f.id}, ${f.proveedor}, ${f.proveedor_ref}, ${f.titulo}, ${f.id_usuario},
      ${f.id_publicacion}, ${f.estado}, ${f.etapa}, ${f.progreso}, ${f.mensaje},
      ${f.n_fotos}, ${f.es_video}, ${f.calidad_estimada}, ${f.modelo_bytes},
      ${f.modelo_url}, ${f.motor}, ${f.error}, ${f.creado_en}, ${f.expira_en})
    ON CONFLICT (id) DO UPDATE SET
      proveedor = EXCLUDED.proveedor,
      proveedor_ref = EXCLUDED.proveedor_ref,
      titulo = EXCLUDED.titulo,
      estado = EXCLUDED.estado,
      etapa = EXCLUDED.etapa,
      progreso = EXCLUDED.progreso,
      mensaje = EXCLUDED.mensaje,
      n_fotos = EXCLUDED.n_fotos,
      es_video = EXCLUDED.es_video,
      calidad_estimada = EXCLUDED.calidad_estimada,
      modelo_bytes = EXCLUDED.modelo_bytes,
      modelo_url = EXCLUDED.modelo_url,
      motor = EXCLUDED.motor,
      error = EXCLUDED.error,
      expira_en = EXCLUDED.expira_en
  `;
}

export async function leerFila(id) {
  await tabla();
  const d = db();
  const filas = await d`SELECT * FROM gemelo_jobs WHERE id = ${id}`;
  return filas[0] || null;
}

export async function borrarFila(id) {
  await tabla();
  const d = db();
  await d`DELETE FROM gemelo_jobs WHERE id = ${id}`;
}

export async function guardarGlb(id, bytes) {
  await tabla();
  const d = db();
  const hex = Buffer.from(bytes).toString('hex');
  await d`UPDATE gemelo_jobs SET modelo_glb = decode(${hex}, 'hex'), modelo_bytes = ${bytes.length} WHERE id = ${id}`;
}

export async function leerGlb(id) {
  await tabla();
  const d = db();
  const filas = await d`SELECT encode(modelo_glb, 'hex') AS glb, modelo_bytes FROM gemelo_jobs WHERE id = ${id}`;
  const hex = filas[0]?.glb;
  if (!hex) return null;
  return { bytes: Buffer.from(hex, 'hex'), bytesLen: Number(filas[0].modelo_bytes || 0) };
}

export const urlPropia = (url, id) => `${new URL(url).origin}/api/modelo/${id}`;

export function armarEstado(fila, origen) {
  const creado = Number(fila.creado_en);
  const transcurrido = Date.now() - creado;
  let restante = null;
  if (fila.progreso > 5 && fila.progreso < 100) {
    restante = Math.round((transcurrido * (100 - fila.progreso)) / fila.progreso / 1000);
  }
  return {
    id: fila.id,
    titulo: fila.titulo,
    estado: fila.estado,
    etapa: fila.etapa,
    progreso: Number(fila.progreso) || 0,
    mensaje: fila.mensaje,
    totalFotos: Number(fila.n_fotos) || 0,
    nFotos: Number(fila.n_fotos) || 0,
    esVideo: Boolean(fila.es_video),
    calidadEstimada: fila.calidad_estimada,
    tiempoEstimadoSeg: restante,
    modeloUrl:
      fila.modelo_url || (Number(fila.modelo_bytes) > 0 ? `/api/modelo/${fila.id}` : null),
    modeloBytes: fila.modelo_bytes === null || fila.modelo_bytes === undefined ? null : Number(fila.modelo_bytes),
    error: fila.error,
    motor: fila.motor,
    creadoEn: creado,
    expiraEn: fila.expira_en ? Number(fila.expira_en) : null,
    ...(origen || {}),
  };
}

const fallar = async (fila, mensaje) => {
  fila.estado = 'error';
  fila.etapa = 'error';
  fila.error = mensaje;
  fila.mensaje = mensaje;
  await guardarFila(fila);
  return fila;
};

// ── KIRI ─────────────────────────────────────────────────────────────────────
// status: -1 subiendo, 0 procesando, 1 falló, 2 ok, 3 en cola, 4 expiró
const MAPEO_KIRI = {
  '-1': { etapa: 'recibiendo', progreso: 12, mensaje: 'Subiendo el material a KIRI Engine…' },
  '3': { etapa: 'recibiendo', progreso: 20, mensaje: 'En cola de procesamiento en KIRI Engine…' },
  '0': { etapa: 'reconstruyendo', progreso: 60, mensaje: 'Reconstruyendo la geometría y la textura…' },
};

async function estadoKiri(fila) {
  const cacheado = enCache(fila.id);
  if (cacheado) return cacheado;

  const ref = fila.proveedor_ref;
  const r = await fetch(`${API_KIRI}/model/getStatus?serialize=${encodeURIComponent(ref)}`, {
    headers: encabezadoKiri(),
    signal: AbortSignal.timeout(20000),
  });
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok || !cuerpo || cuerpo.ok !== true) {
    throw new Error(cuerpo?.msg || `KIRI responde HTTP ${r.status}`);
  }
  const st = String(cuerpo.data?.status);

  if (st === '2') {
    // materializar: pedir el zip, bajarlo, extraer el .glb y guardarlo
    fila.etapa = 'convirtiendo';
    fila.progreso = 85;
    fila.mensaje = 'Descargando y convirtiendo el modelo…';
    await guardarFila(fila);
    const rz = await fetch(`${API_KIRI}/model/getModelZip?serialize=${encodeURIComponent(ref)}`, {
      headers: encabezadoKiri(),
      signal: AbortSignal.timeout(20000),
    });
    const cj = await rz.json().catch(() => null);
    const zipUrl = cj?.data?.modelUrl;
    if (!zipUrl) throw new Error('KIRI no devolvió el enlace del modelo.');
    const zipRes = await fetch(zipUrl, { signal: AbortSignal.timeout(120000) });
    if (!zipRes.ok) throw new Error(`No se pudo bajar el ZIP (${zipRes.status}).`);
    const zip = new Uint8Array(await zipRes.arrayBuffer());
    const glb = extraerGlb(zip);
    await guardarGlb(fila.id, glb);
    fila.estado = 'listo';
    fila.etapa = 'listo';
    fila.progreso = 100;
    fila.mensaje = 'Modelo listo';
    await guardarFila(fila);
    const estado = armarEstado(fila);
    ponerEnCache(fila.id, estado);
    return estado;
  }

  if (st === '1' || st === '4') {
    await fallar(
      fila,
      st === '4'
        ? 'La reconstrucción expiró. Volvé a generarla con menos material.'
        : 'KIRI Engine no pudo reconstruir el modelo. Probá con más solapamiento o mejor luz.'
    );
    const estado = armarEstado(fila);
    ponerEnCache(fila.id, estado);
    return estado;
  }

  const base = MAPEO_KIRI[st] || { etapa: 'reconstruyendo', progreso: 55, mensaje: 'Procesando en KIRI Engine…' };
  fila.etapa = base.etapa;
  fila.progreso = base.progreso;
  fila.mensaje = base.mensaje;
  fila.estado = 'procesando';
  await guardarFila(fila);
  const estado = armarEstado(fila);
  ponerEnCache(fila.id, estado);
  return estado;
}

// ── MakeSplat ────────────────────────────────────────────────────────────────
const MAPEO_MAKESPLAT = {
  upload: { etapa: 'recibiendo', progreso: 15, mensaje: 'Subiendo el video a MakeSplat…' },
  uploading: { etapa: 'recibiendo', progreso: 15, mensaje: 'Subiendo el video a MakeSplat…' },
  reserved: { etapa: 'recibiendo', progreso: 15, mensaje: 'Reservando el escaneo…' },
  pending: { etapa: 'recibiendo', progreso: 18, mensaje: 'En cola de procesamiento…' },
  queued: { etapa: 'recibiendo', progreso: 20, mensaje: 'En cola de procesamiento…' },
  processing: { etapa: 'reconstruyendo', progreso: 60, mensaje: 'Reconstruyendo el recorrido en 3D…' },
};

async function estadoMakeSplat(fila) {
  const cacheado = enCache(fila.id);
  if (cacheado) return cacheado;

  const r = await fetch(`${API_MAKESPLAT}/v1/scans/${encodeURIComponent(fila.proveedor_ref)}`, {
    headers: encabezadoMakeSplat(),
    signal: AbortSignal.timeout(20000),
  });
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok || !cuerpo) throw new Error(`MakeSplat responde HTTP ${r.status}`);
  const st = String(cuerpo.status || '').toLowerCase();
  const mesh = cuerpo.mesh || null;

  if (st === 'done' && mesh && String(mesh.status).toLowerCase() === 'done' && mesh.url) {
    fila.estado = 'listo';
    fila.etapa = 'listo';
    fila.progreso = 100;
    fila.mensaje = 'Modelo listo';
    fila.modelo_url = mesh.url;
    fila.modelo_bytes = Number(mesh.bytes || mesh.size) || null;
    await guardarFila(fila);
    const estado = armarEstado(fila);
    ponerEnCache(fila.id, estado);
    return estado;
  }

  if (['failed', 'error', 'canceled', 'cancelled', 'expired'].includes(st)) {
    await fallar(fila, 'MakeSplat no pudo generar el modelo. Probá con otro video.');
    const estado = armarEstado(fila);
    ponerEnCache(fila.id, estado);
    return estado;
  }

  if (st === 'done' && (!mesh || String(mesh.status).toLowerCase() !== 'done')) {
    await fallar(fila, 'El video se procesó pero el mesh 3D falló. Probá con un recorrido más corto.');
    const estado = armarEstado(fila);
    ponerEnCache(fila.id, estado);
    return estado;
  }

  const base = MAPEO_MAKESPLAT[st] || {
    etapa: 'reconstruyendo',
    progreso: 55,
    mensaje: 'Procesando el escaneo en MakeSplat…',
  };
  fila.etapa = base.etapa;
  fila.progreso = base.progreso;
  fila.mensaje = base.mensaje;
  fila.estado = 'procesando';
  await guardarFila(fila);
  const estado = armarEstado(fila);
  ponerEnCache(fila.id, estado);
  return estado;
}

// ── simulación (fallback sin credenciales) ───────────────────────────────────
const DURACION_SIMULADA_MS = 15_000;
async function estadoSimulado(fila) {
  const transcurrido = Date.now() - Number(fila.creado_en);
  const esMotivo = /^(Sin credenciales|MakeSplat|Motor 3D)/.test(fila.mensaje || '');
  if (transcurrido >= DURACION_SIMULADA_MS) {
    fila.estado = 'listo';
    fila.etapa = 'listo';
    fila.progreso = 100;
    fila.mensaje = esMotivo ? fila.mensaje : 'Modelo de demostración listo';
    fila.modelo_url = resolverUrlModeloFallback(valor('GEMELO_MODELO_FALLBACK'));
    await guardarFila(fila);
  } else {
    fila.progreso = Math.min(97, Math.round((transcurrido / DURACION_SIMULADA_MS) * 100));
    if (!esMotivo) fila.mensaje = 'Simulando la reconstrucción…';
    fila.etapa = fila.progreso > 80 ? 'convirtiendo' : fila.progreso > 30 ? 'reconstruyendo' : 'recibiendo';
    await guardarFila(fila);
  }
  return armarEstado(fila);
}

// ── API pública del módulo ───────────────────────────────────────────────────
export async function consultarEstado(id) {
  const cacheado = enCache(id);
  if (cacheado) return cacheado;
  const fila = await leerFila(id);
  if (!fila) return null;
  if (fila.estado === 'listo' || fila.estado === 'error') {
    return armarEstado(fila);
  }
  let estado;
  try {
    if (fila.proveedor === 'kiri') estado = await estadoKiri(fila);
    else if (fila.proveedor === 'makesplat') estado = await estadoMakeSplat(fila);
    else if (fila.proveedor === 'simular') estado = await estadoSimulado(fila);
    else estado = armarEstado(fila);
  } catch (e) {
    fila.mensaje = `Reintentando: ${e instanceof Error ? e.message : 'error de red'}`;
    await guardarFila(fila);
    estado = armarEstado(fila);
    ponerEnCache(fila.id, estado);
  }
  return estado;
}

export async function crearSimulado(datos, motivo = null) {
  const fila = nuevaFila({
    id: `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    proveedor: 'simular',
    titulo: datos.titulo,
    idUsuario: datos.idUsuario,
    idPublicacion: datos.idPublicacion,
    nFotos: datos.nFotos,
    esVideo: datos.esVideo,
    motor: 'simular',
  });
  fila.mensaje = motivo || 'Sin credenciales de reconstrucción: se usa el modelo de demostración.';
  await guardarFila(fila);
  return fila;
}

/** Crea el trabajo en KIRI reenviando el multipart crudo (sin cargarlo en memoria). */
export async function crearEnKiri({ request, url, titulo, idUsuario, idPublicacion, nFotos, esVideo }) {
  const destino = `${API_KIRI}/${esVideo ? 'photo/video' : 'photo/image'}`;
  const r = await fetch(destino, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${valor('KIRI_API_KEY')}`,
      'Content-Type': request.headers.get('content-type') || 'multipart/form-data',
    },
    body: request.body,
    duplex: 'half',
  });
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok || !cuerpo || cuerpo.ok !== true) {
    throw new Error(cuerpo?.msg || `KIRI rechazó la subida (HTTP ${r.status}).`);
  }
  const ref = cuerpo.data?.serialize;
  if (!ref) throw new Error('KIRI no devolvió el identificador del trabajo.');
  const fila = nuevaFila({
    id: ref,
    proveedor: 'kiri',
    proveedorRef: ref,
    titulo,
    idUsuario,
    idPublicacion,
    nFotos,
    esVideo,
    motor: 'externo',
  });
  await guardarFila(fila);
  return fila;
}

/** Crea el trabajo en MakeSplat: reserva, sube el video al enlace firmado y arranca. */
export async function crearEnMakeSplat({ request, titulo, idUsuario, idPublicacion, nFotos, esVideo }) {
  const reserva = await fetch(`${API_MAKESPLAT}/v1/scans`, {
    method: 'POST',
    headers: encabezadoMakeSplat(),
    signal: AbortSignal.timeout(30000),
  });
  const cuerpo = await reserva.json().catch(() => null);
  if (!reserva.ok || !cuerpo?.job_id) {
    throw new Error(cuerpo?.error || `MakeSplat no reservó el escaneo (HTTP ${reserva.status}).`);
  }
  const { job_id: jobId, upload_url: uploadUrl } = cuerpo;

  const form = await request.formData();
  const archivo = form.get('videoFile') || form.get('fotos') || form.get('imagesFiles');
  if (!archivo || typeof archivo === 'string') {
    throw new Error('MakeSplat trabaja con video: subí un MP4 o MOV.');
  }
  const subida = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': archivo.type || 'video/mp4' },
    body: archivo.stream(),
    duplex: 'half',
    signal: AbortSignal.timeout(300000),
  });
  if (!subida.ok) throw new Error(`No se pudo subir el video (HTTP ${subida.status}).`);

  const arranque = await fetch(`${API_MAKESPLAT}/v1/scans/${jobId}/start`, {
    method: 'POST',
    headers: { ...encabezadoMakeSplat(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ params: { mesh: true } }),
    signal: AbortSignal.timeout(30000),
  });
  const cuerpoArranque = await arranque.json().catch(() => null);
  if (!arranque.ok) {
    throw new Error(cuerpoArranque?.error || `MakeSplat no arrancó el escaneo (HTTP ${arranque.status}).`);
  }

  const fila = nuevaFila({
    id: jobId,
    proveedor: 'makesplat',
    proveedorRef: jobId,
    titulo,
    idUsuario,
    idPublicacion,
    nFotos,
    esVideo,
    motor: 'externo',
  });
  await guardarFila(fila);
  return fila;
}

/** Guarda un .glb subido a mano ("ya tengo un modelo"). */
export async function guardarModeloExterno({ bytes, titulo, idUsuario, idPublicacion }) {
  const id = `ext-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const fila = nuevaFila({
    id,
    proveedor: 'externo',
    titulo,
    idUsuario,
    idPublicacion,
    nFotos: 0,
    esVideo: false,
    motor: 'externo',
  });
  fila.estado = 'listo';
  fila.etapa = 'listo';
  fila.progreso = 100;
  fila.mensaje = 'Modelo vinculado';
  await guardarFila(fila);
  await guardarGlb(id, bytes);
  return id;
}

/** Extrae el .glb más grande de un ZIP (KIRI devuelve varios formatos). */
export function extraerGlb(zip) {
  const archivos = unzipSync(zip);
  let mejor = null;
  let mejorTam = 0;
  for (const [nombre, datos] of Object.entries(archivos)) {
    if (!nombre.toLowerCase().endsWith('.glb')) continue;
    if (datos.length > mejorTam) {
      mejor = datos;
      mejorTam = datos.length;
    }
  }
  if (!mejor) throw new Error('El ZIP no contiene un archivo .glb.');
  return mejor;
}