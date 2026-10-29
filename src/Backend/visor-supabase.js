const BUCKET_POR_DEFECTO = 'visor3d';
const TABLA_POR_DEFECTO = 'visor3d_trabajos';

export const BUCKET = (process.env.SUPABASE_VISOR_BUCKET || BUCKET_POR_DEFECTO).trim() || BUCKET_POR_DEFECTO;
export const TABLA = (process.env.SUPABASE_VISOR_TABLA || TABLA_POR_DEFECTO).trim() || TABLA_POR_DEFECTO;

export const MAX_MEDIA_BYTES = 600 * 1024 * 1024;
export const MAX_GLB_BYTES = 50 * 1024 * 1024;

const URL_IMAGEN = /^image\//i;
const URL_VIDEO = /^video\/(mp4|quicktime|webm|x-m4v)$/i;
const EXT_IMAGEN = /\.(jpe?g|png|webp|heic|heif|avif)$/i;
const EXT_VIDEO = /\.(mp4|mov|m4v|webm)$/i;

const limpiarUrl = (valor) => String(valor || '').trim().replace(/\/+$/, '');
const clave = () => String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

export function visorConfigurado() {
  return Boolean(limpiarUrl(process.env.SUPABASE_URL) && clave());
}

export function tipoClave() {
  const valor = clave();
  if (!valor) return 'ausente';
  if (valor.startsWith('sb_secret_')) return 'secret';
  if (valor.startsWith('sb_publishable_')) return 'publica';

  const partes = valor.split('.');
  if (partes.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString());
      return payload?.role === 'service_role' ? 'service_role' : 'jwt-otro';
    } catch {
      return 'jwt-ilegible';
    }
  }
  return 'desconocida';
}

export const claveEsPublica = () => ['publica', 'jwt-otro'].includes(tipoClave());

export const visorOperativo = () => visorConfigurado() && !claveEsPublica();

export const mensajeClave =
  'La clave de Supabase es pública (anon / publishable). El visor necesita la clave secreta: Project Settings → API → service_role, o una Secret key (sb_secret_…).';

export const errorConfiguracion = () =>
  visorConfigurado()
    ? mensajeClave
    : 'Supabase no está configurado: faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.';

export const responderJson = (status, cuerpo) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function exigirConfiguracion() {
  if (!visorConfigurado()) {
    throw new Error(
      'Supabase no está configurado: faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
}

const cabeceras = (extra = {}) => ({
  apikey: clave(),
  Authorization: `Bearer ${clave()}`,
  ...extra,
});

const rest = () => `${limpiarUrl(process.env.SUPABASE_URL)}/rest/v1/${encodeURIComponent(TABLA)}`;
const storage = (ruta) => `${limpiarUrl(process.env.SUPABASE_URL)}/storage/v1/${ruta}`;

export function codificarRuta(ruta) {
  return String(ruta || '')
    .split('/')
    .filter((parte) => parte.length > 0)
    .map(encodeURIComponent)
    .join('/');
}

export function nombreSeguro(nombre) {
  const base = String(nombre || 'archivo').split(/[\\/]/).pop() || 'archivo';
  const limpio = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(-80);
  return limpio || 'archivo';
}

export function clasificarArchivo(tipo, nombre) {
  const mime = String(tipo || '');
  const archivo = String(nombre || '');
  if (URL_IMAGEN.test(mime)) return 'imagen';
  if (URL_VIDEO.test(mime)) return 'video';
  if (EXT_VIDEO.test(archivo)) return 'video';
  if (EXT_IMAGEN.test(archivo)) return 'imagen';
  return null;
}

export function rutaMedia(id, indice, nombre) {
  return `${id}/media/${indice}-${nombreSeguro(nombre)}`;
}

export function rutaModelo(id) {
  return `${id}/modelo.glb`;
}

async function pedir(url, opciones = {}) {
  const respuesta = await fetch(url, opciones);
  const texto = await respuesta.text();
  let cuerpo = null;
  if (texto) {
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      cuerpo = null;
    }
  }
  if (!respuesta.ok) {
    const detalle = cuerpo?.message || cuerpo?.error || texto || `HTTP ${respuesta.status}`;
    throw new Error(`Supabase ${respuesta.status}: ${String(detalle).slice(0, 300)}`);
  }
  return cuerpo;
}

export async function crearFila(datos) {
  exigirConfiguracion();
  const filas = await pedir(rest(), {
    method: 'POST',
    headers: cabeceras({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify([datos]),
  });
  const fila = Array.isArray(filas) ? filas[0] : null;
  if (!fila) throw new Error('Supabase no devolvió el trabajo creado.');
  return fila;
}

export async function leerFila(id) {
  exigirConfiguracion();
  const url = `${rest()}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`;
  const filas = await pedir(url, { headers: cabeceras() });
  return Array.isArray(filas) && filas.length ? filas[0] : null;
}

export async function actualizarFila(id, cambios) {
  exigirConfiguracion();
  const filas = await pedir(`${rest()}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: cabeceras({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(cambios),
  });
  const fila = Array.isArray(filas) ? filas[0] : null;
  if (!fila) throw new Error('Supabase no devolvió el trabajo actualizado.');
  return fila;
}

export async function borrarFila(id) {
  exigirConfiguracion();
  await pedir(`${rest()}?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: cabeceras({ Prefer: 'return=minimal' }),
  });
}

export function urlListarTrabajos({ publicacionId, usuarioId, limite = 5 } = {}) {
  if (!publicacionId && !usuarioId) {
    throw new Error('Filtrá por publicacion_id o usuario_id.');
  }
  const params = new URLSearchParams({
    select: '*',
    order: 'creado_en.desc',
    limit: String(Math.min(Math.max(Number(limite) || 5, 1), 20)),
  });
  if (publicacionId) params.set('publicacion_id', `eq.${publicacionId}`);
  else params.set('usuario_id', `eq.${usuarioId}`);
  return `${rest()}?${params.toString()}`;
}

export async function listarTrabajos(filtros) {
  exigirConfiguracion();
  const filas = await pedir(urlListarTrabajos(filtros), { headers: cabeceras() });
  return Array.isArray(filas) ? filas : [];
}

export async function listarTrabajosExpirados(limite = 50) {
  exigirConfiguracion();
  const params = new URLSearchParams({
    select: '*',
    expira_en: `lt.${new Date().toISOString()}`,
    limit: String(Math.min(Math.max(Number(limite) || 50, 1), 200)),
  });
  const filas = await pedir(`${rest()}?${params.toString()}`, { headers: cabeceras() });
  return Array.isArray(filas) ? filas : [];
}

export async function vincularPublicacionTrabajo(trabajoId, publicacionId) {
  return actualizarFila(trabajoId, { publicacion_id: publicacionId });
}

export async function firmarSubida(ruta) {
  exigirConfiguracion();
  const cuerpo = await pedir(storage(`object/upload/sign/${BUCKET}/${codificarRuta(ruta)}`), {
    method: 'POST',
    headers: cabeceras({ 'Content-Type': 'application/json' }),
    body: '{}',
  });
  const relativa = cuerpo?.url;
  if (!relativa) throw new Error('Supabase no devolvió la URL firmada de subida.');
  return { ruta, url: `${limpiarUrl(process.env.SUPABASE_URL)}/storage/v1${relativa}` };
}

export async function subirObjeto(ruta, bytes, contentType) {
  exigirConfiguracion();
  await pedir(storage(`object/${BUCKET}/${codificarRuta(ruta)}`), {
    method: 'POST',
    headers: cabeceras({
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true',
    }),
    body: bytes,
  });
}

export async function abrirObjeto(ruta, { rango } = {}) {
  exigirConfiguracion();
  const headers = cabeceras();
  if (rango) headers.Range = rango;
  const codificada = `${BUCKET}/${codificarRuta(ruta)}`;
  const candidatas = [
    storage(`object/authenticated/${codificada}`),
    storage(`object/${codificada}`),
  ];

  let ultima = null;
  for (const url of candidatas) {
    const respuesta = await fetch(url, { headers });
    if (respuesta.ok || respuesta.status !== 404) return respuesta;
    ultima = respuesta;
    await respuesta.body?.cancel?.().catch(() => {});
  }
  return ultima;
}

export async function descargarObjeto(ruta) {
  return abrirObjeto(ruta);
}

export async function inspeccionarObjeto(ruta) {
  const respuesta = await abrirObjeto(ruta, { rango: 'bytes=0-3' });
  if (!respuesta.ok) return { existe: false, esGlb: false, bytes: 0 };

  const rango = respuesta.headers.get('content-range');
  const bytes = rango
    ? Number(rango.split('/').pop()) || 0
    : Number(respuesta.headers.get('content-length')) || 0;

  let cabecera = new Uint8Array(0);
  const lector = respuesta.body?.getReader();
  if (lector) {
    const { value } = await lector.read();
    if (value) cabecera = value;
    await lector.cancel().catch(() => {});
  }

  const esGlb =
    cabecera.length >= 4 &&
    cabecera[0] === 0x67 &&
    cabecera[1] === 0x6c &&
    cabecera[2] === 0x54 &&
    cabecera[3] === 0x46;

  return { existe: true, esGlb, bytes };
}

export async function borrarObjetos(rutas) {
  const lista = (rutas || []).filter(Boolean);
  if (!lista.length) return;
  exigirConfiguracion();
  await pedir(storage(`object/${BUCKET}`), {
    method: 'DELETE',
    headers: cabeceras({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: lista }),
  });
}

const ESTADO_API = {
  subiendo: 'recibiendo',
  subido: 'pendiente',
  procesando: 'procesando',
  listo: 'listo',
  error: 'error',
};

const ETAPA_API = {
  subiendo: 'recibiendo',
  subido: 'reconstruyendo',
  procesando: 'reconstruyendo',
  listo: 'listo',
  error: 'error',
};

export function estadoDesdeFila(fila) {
  if (!fila) return null;
  const modeloUrl = fila.modelo_path
    ? `/api/visor/glb/${fila.id}`
    : fila.modelo_url || null;

  return {
    id: fila.id,
    titulo: fila.titulo,
    estado: ESTADO_API[fila.estado] || 'procesando',
    etapa: ETAPA_API[fila.estado] || 'reconstruyendo',
    progreso: Number(fila.progreso) || 0,
    mensaje: fila.mensaje,
    totalFotos: Number(fila.n_fotos) || 0,
    nFotos: Number(fila.n_fotos) || 0,
    esVideo: Boolean(fila.es_video),
    calidadEstimada: fila.calidad || null,
    tiempoEstimadoSeg: null,
    modeloUrl,
    modeloBytes:
      fila.modelo_bytes === null || fila.modelo_bytes === undefined
        ? null
        : Number(fila.modelo_bytes),
    error: fila.error,
    motor: 'externo',
    creadoEn: Date.parse(fila.creado_en) || Date.now(),
    expiraEn: fila.expira_en ? Date.parse(fila.expira_en) : null,
  };
}
