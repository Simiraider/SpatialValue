import { Client, handle_file } from '@gradio/client';
import {
  MAX_GLB_BYTES,
  abrirObjeto,
  actualizarFila,
  marcarDemo,
  rutaModelo,
  subirObjeto,
} from './visor-supabase.js';

export const ESPACIO_MAST3R = (process.env.MAST3R_SPACE || 'naver/MASt3R').trim() || 'naver/MASt3R';
export const MAX_CUADROS = 8;
export const MIN_FOTOS = MAX_CUADROS;
export const MAX_FOTOS = MAX_CUADROS;

// La ruta de Vercel corre con maxDuration 300 s: cortamos MASt3R antes para
// poder descargar el .glb, subirlo a Supabase y responder sin que nos maten.
export const LIMITE_MAST3R_MS = 3 * 60 * 1000;

// Cada cuánto, como máximo, el trabajo "late" aunque no haya novedades.
const INTERVALO_LATIDO_MS = 15_000;

const API_MAST3R = '/local_get_reconstructed_scene';

// Dueño/nombre del Space en el Hub (naver/MASt3R → naver-mast3r.hf.space).
const ID_ESPACIO = /^https?:/i.test(ESPACIO_MAST3R) ? '' : ESPACIO_MAST3R;
const RAIZ_ESPACIO = ID_ESPACIO
  ? `https://${ID_ESPACIO.replace(/[/_]/g, '-').toLowerCase()}.hf.space`
  : new URL(ESPACIO_MAST3R).origin;

export const mast3rConfigurado = () =>
  String(process.env.MAST3R_DESHABILITADO || '').trim() !== '1';

/**
 * Junta las URLs de archivo de la respuesta. El cliente de Gradio ya firma los
 * FileData con `__sign` antes de entregarlos, así que esas URLs quedan primeras
 * y no hace falta volver a firmarlas.
 */
function urlsDeSalida(datos) {
  const urls = [];
  const agregar = (valor) => {
    const crudo =
      typeof valor === 'string'
        ? valor
        : valor && typeof valor === 'object' && typeof valor.url === 'string'
          ? valor.url
          : null;
    if (!crudo) return;
    let absoluta;
    try {
      absoluta = new URL(crudo, `${RAIZ_ESPACIO}/`).toString();
    } catch {
      return;
    }
    if (!/^https?:/i.test(absoluta) || urls.includes(absoluta)) return;
    urls.push(absoluta);
  };
  for (const dato of datos) {
    if (Array.isArray(dato)) dato.forEach(agregar);
    else agregar(dato);
  }
  const puntaje = (url) =>
    (/[^/]*\.glb(\?|$)/i.test(url) ? 0 : 2) + (url.includes('__sign=') ? 0 : 1);
  return [...urls].sort((a, b) => puntaje(a) - puntaje(b));
}

/** Host + ruta sin query: en los logs nunca aparecen firmas ni tokens. */
function describirUrl(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return String(url).slice(0, 80);
  }
}

/** Recorta y tapa cualquier credencial que venga en un cuerpo de error. */
function limpiarDetalle(texto) {
  return String(texto || '')
    .replace(/__sign=[^&\s"']+/g, '__sign=***')
    .replace(/\bhf_[A-Za-z0-9]{8,}/g, 'hf_***')
    .replace(/\beyJ[A-Za-z0-9._-]{16,}/g, 'jwt_***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

let firmaCache = { valor: '', hasta: 0 };

/** Pide el JWT del Space; sólo se usa si el archivo no vino ya firmado. */
async function firmaDelEspacio(token) {
  if (!token || !ID_ESPACIO) return '';
  if (firmaCache.valor && Date.now() < firmaCache.hasta) return firmaCache.valor;
  try {
    const respuesta = await fetch(`https://huggingface.co/api/spaces/${ID_ESPACIO}/jwt`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!respuesta.ok) return '';
    const { token: firma } = await respuesta.json();
    if (!firma) return '';
    firmaCache = { valor: firma, hasta: Date.now() + 10 * 60 * 1000 };
    return firma;
  } catch {
    return '';
  }
}

function agregarFirma(url, firma) {
  if (!firma || url.includes('__sign=')) return url;
  try {
    const conFirma = new URL(url);
    conFirma.searchParams.set('__sign', firma);
    return conFirma.toString();
  } catch {
    return url;
  }
}

/**
 * Baja la primera salida que sea realmente un .glb (magic bytes `glTF`).
 * Orden: la URL tal como la devolvió Gradio (los FileData ya vienen firmados),
 * la misma firmada con el JWT del Space y, si hay token, un pedido con
 * `Authorization` (Hugging Face lo usa en algunas rutas de archivos).
 * Si todo falla, el error dice host, ruta, si se usó `__sign` y el estado HTTP.
 */
async function descargarModelo(candidatas) {
  const token = String(process.env.HF_TOKEN || '').trim();
  const firma = await firmaDelEspacio(token);
  const fallos = [];
  const probados = new Set();

  for (const original of candidatas) {
    const firmada = agregarFirma(original, firma);
    const usaFirmaPropia = original.includes('__sign=');
    const planes = [
      { url: firmada, firma: firmada !== original || usaFirmaPropia, auth: false },
      { url: original, firma: usaFirmaPropia, auth: false },
    ];
    if (token) planes.push({ url: firmada, firma: firmada !== original || usaFirmaPropia, auth: true });

    for (const plan of planes) {
      const clave = `${plan.url}|${plan.auth ? 'token' : 'anonimo'}`;
      if (probados.has(clave)) continue;
      probados.add(clave);

      const etiqueta =
        `${describirUrl(plan.url)} (firma __sign: ${plan.firma ? 'sí' : 'no'}, ` +
        `${plan.auth ? 'con token' : 'sin token'})`;

      try {
        const respuesta = await fetch(plan.url, {
          headers: plan.auth ? { Authorization: `Bearer ${token}` } : {},
          signal: AbortSignal.timeout(120_000),
        });
        if (!respuesta.ok) {
          const detalle = limpiarDetalle(await respuesta.text().catch(() => ''));
          fallos.push(`${etiqueta} → HTTP ${respuesta.status}${detalle ? ` · ${detalle}` : ''}`);
          continue;
        }
        const bytes = new Uint8Array(await respuesta.arrayBuffer());
        const cabecera = String.fromCharCode(...bytes.subarray(0, 4));
        if (bytes.byteLength > 12 && cabecera === 'glTF') return bytes;
        fallos.push(
          `${etiqueta} → HTTP ${respuesta.status} pero no es un .glb (${bytes.byteLength} bytes)`
        );
      } catch (e) {
        fallos.push(`${etiqueta} → ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  if (fallos.some((fallo) => /File not allowed/i.test(fallo))) {
    console.error(
      'MASt3R: el Space rechazó la ruta del .glb ("File not allowed"). No es un problema de tu código ' +
        'ni del token: el Space (Gradio 4.38) escribe el modelo en su propio tempfile.mkdtemp() y su ruta ' +
        '/file= sólo sirve archivos dentro de las carpetas que Gradio tiene permitidas, así que devuelve ' +
        '403 tanto con firma __sign como sin ella. La reconstrucción termina bien y el archivo queda en el ' +
        'contenedor del Space, pero no se puede bajar por HTTP. Se usa el modelo de demostración.'
    );
  } else if (fallos.some((fallo) => fallo.includes('HTTP 403'))) {
    console.error(
      'MASt3R: la descarga del .glb devolvió 403 sin ser un rechazo de ruta. Revisá que HF_TOKEN sea de ' +
        'una cuenta con acceso al Space (ZeroGPU exige sesión), que la firma __sign corresponda a la misma ' +
        'sesión que ejecutó el trabajo y que /tmp/gradio no se haya purgado al reiniciarse el Space.'
    );
  }

  throw new Error(
    `No se pudo descargar el modelo. ${fallos.join(' | ') || 'No hubo URLs para probar.'}`
  );
}

function conLimite(promesa, ms, mensaje) {
  let temporizador;
  const limite = new Promise((_, rechazar) => {
    temporizador = setTimeout(() => {
      const error = new Error(mensaje);
      error.tiempoAgotado = true;
      rechazar(error);
    }, ms);
  });
  promesa.catch(() => {});
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
}

/**
 * Escribe mensaje/progreso y renueva el latido. Nunca bloquea el procesamiento:
 * si el latido falla (por ejemplo, la columna todavía no existe) reintenta solo
 * con el mensaje y el progreso.
 */
function crearReporte(trabajoId) {
  let ultimaFirma = '';
  let ultimoEnvio = 0;
  let latidoSoportado = true;

  return (mensaje, progreso, forzar = false) => {
    const ahora = Date.now();
    const valor = Math.round(Math.max(0, Math.min(100, progreso)));
    const valorMensaje = String(mensaje || '').slice(0, 400);
    const firma = `${valor}|${valorMensaje}`;
    const cambio = firma !== ultimaFirma;
    const espera = cambio ? 2000 : INTERVALO_LATIDO_MS;
    if (!forzar && ahora - ultimoEnvio < espera) return;

    ultimaFirma = firma;
    ultimoEnvio = ahora;

    const cambios = { mensaje: valorMensaje, progreso: valor };
    if (latidoSoportado) cambios.latido_en = new Date(ahora).toISOString();

    void actualizarFila(trabajoId, cambios).catch(() => {
      if (!latidoSoportado) return;
      latidoSoportado = false;
      void actualizarFila(trabajoId, { mensaje: valorMensaje, progreso: valor }).catch(() => {});
    });
  };
}

/** Traduce el estado de Gradio (cola / GPU / progreso) a un mensaje para el usuario. */
function avisoDesdeEstado(estado) {
  const etapa = String(estado?.stage || '');
  if (etapa === 'pending') {
    const posicion = Number(estado?.position);
    const eta = Number(estado?.eta);
    const cola =
      Number.isFinite(posicion) && posicion > 0
        ? `posición ${posicion} en la cola`
        : 'esperando turno en la GPU';
    const demora =
      Number.isFinite(eta) && eta > 0 ? ` · demora estimada ${Math.round(eta)} s` : '';
    return {
      mensaje: `MASt3R tiene el pedido en cola (${cola})${demora}…`,
      progreso: 45,
    };
  }
  if (etapa === 'generating' || etapa === 'streaming') {
    const crudo = Number(estado?.progress_data?.progress);
    let fraccion = Number.isFinite(crudo) ? crudo : 0;
    if (fraccion > 1) fraccion = fraccion / 100;
    fraccion = Math.max(0, Math.min(1, fraccion));
    return {
      mensaje: 'MASt3R está reconstruyendo las fotos en la GPU…',
      progreso: 45 + Math.round(fraccion * 35),
    };
  }
  return null;
}

async function prepararCuadros(rutas) {
  const cuadros = [];
  for (const ruta of rutas.slice(0, MAX_CUADROS)) {
    try {
      const respuesta = await abrirObjeto(ruta);
      if (!respuesta?.ok) continue;
      const tipo = String(respuesta.headers.get('content-type') || 'image/jpeg').split(';')[0];
      const esImagen = tipo.startsWith('image/') || /\.(jpe?g|png|webp|avif|heic|heif)$/i.test(String(ruta));
      if (!esImagen) continue;
      const bytes = await respuesta.arrayBuffer();
      if (!bytes.byteLength) continue;
      const nombre = String(ruta).split('/').pop() || `cuadro-${cuadros.length + 1}.jpg`;
      cuadros.push(handle_file(new File([bytes], nombre, { type: tipo })));
    } catch (e) {
      console.error(`No se pudo preparar ${ruta}:`, e);
    }
  }
  return cuadros;
}

async function reconstruir(cuadros, onEstado, control) {
  const token = String(process.env.HF_TOKEN || '').trim();
  const client = await Client.connect(ESPACIO_MAST3R, token ? { token } : {});

  // El endpoint del Space nombra al primer parámetro "filelist" (la lista de
  // fotos); con otro nombre Gradio responde "No value provided for required
  // parameter: filelist". El orden posterior sigue la firma del Space:
  // min_conf_thr, matching_conf_thr, as_pointcloud, cam_size, shared_intrinsics.
  const envio = client.submit(
    API_MAST3R,
    {
      filelist: cuadros,
      min_conf_thr: 1.5,
      matching_conf_thr: 0,
      as_pointcloud: false,
      cam_size: 0.2,
      shared_intrinsics: false,
    },
    null,
    null,
    true
  );

  control.cancelar = () => {
    void envio.cancel().catch(() => {});
  };

  let salida = null;
  for await (const mensaje of envio) {
    if (!mensaje) continue;
    if (mensaje.type === 'data') {
      salida = mensaje.data;
      continue;
    }
    if (mensaje.type !== 'status') continue;
    if (mensaje.stage === 'error') {
      const crudo = mensaje.message;
      throw new Error(
        typeof crudo === 'string' && crudo.trim() ? crudo : 'MASt3R devolvió un error.'
      );
    }
    const aviso = avisoDesdeEstado(mensaje);
    if (aviso) onEstado?.(aviso);
  }

  const urls = urlsDeSalida(Array.isArray(salida) ? salida : []);
  if (!urls.length) throw new Error('MASt3R no devolvió un modelo 3D.');
  return urls;
}

export async function procesarConMASt3R(trabajoId, rutas) {
  let mensaje = 'Enviando las fotos a MASt3R y estimando las cámaras…';
  let progreso = 30;

  const reporte = crearReporte(trabajoId);
  const latido = setInterval(() => reporte(mensaje, progreso, true), INTERVALO_LATIDO_MS);
  const control = {};

  try {
    await actualizarFila(trabajoId, {
      estado: 'procesando',
      etapa: 'reconstruyendo',
      progreso,
      mensaje,
      proveedor: 'mast3r',
      chequeo_en: new Date().toISOString(),
      error: null,
    });
    reporte(mensaje, progreso, true);

    const lista = Array.isArray(rutas) ? rutas : [];

    mensaje = `Preparando ${Math.min(lista.length, MAX_CUADROS)} fotos para MASt3R…`;
    progreso = 38;
    reporte(mensaje, progreso, true);

    const cuadros = await prepararCuadros(lista);
    if (cuadros.length < MIN_FOTOS) {
      throw new Error(
        `Solo se pudieron preparar ${cuadros.length} de ${MIN_FOTOS} fotos para MASt3R.`
      );
    }

    mensaje = `Enviando ${cuadros.length} fotos a MASt3R…`;
    progreso = 42;
    reporte(mensaje, progreso, true);

    const candidatas = await conLimite(
      reconstruir(
        cuadros,
        (aviso) => {
          mensaje = aviso.mensaje;
          progreso = aviso.progreso;
          reporte(mensaje, progreso);
        },
        control
      ),
      LIMITE_MAST3R_MS,
      'MASt3R no terminó de procesar en 3 minutos.'
    );

    mensaje = 'Descargando el modelo y guardándolo en Supabase…';
    progreso = 82;
    reporte(mensaje, progreso, true);

    const glbBytes = await descargarModelo(candidatas);
    if (glbBytes.length > MAX_GLB_BYTES) {
      throw new Error(`El modelo pesa más de ${Math.round(MAX_GLB_BYTES / 1024 / 1024)} MB.`);
    }

    await subirObjeto(rutaModelo(trabajoId), glbBytes, 'model/gltf-binary');

    return await actualizarFila(trabajoId, {
      estado: 'listo',
      etapa: 'listo',
      progreso: 100,
      motor: 'mast3r',
      mensaje: 'Modelo 3D reconstruido con MASt3R.',
      modelo_path: rutaModelo(trabajoId),
      modelo_bytes: glbBytes.length,
      chequeo_en: null,
      error: null,
    });
  } catch (e) {
    const motivo = e instanceof Error ? e.message : 'El procesamiento 3D falló.';
    console.error('MASt3R:', motivo);
    if (typeof control.cancelar === 'function') control.cancelar();
    // Cualquier falla (sin cuota, 403 al bajar el .glb, timeout, etc.) termina en
    // el modelo de demostración para que el visor nunca quede en error.
    return marcarDemo(
      trabajoId,
      e?.tiempoAgotado
        ? 'El motor 3D (MASt3R) no terminó en 3 minutos.'
        : 'El motor 3D (MASt3R) no pudo completar la reconstrucción.'
    );
  } finally {
    clearInterval(latido);
  }
}
