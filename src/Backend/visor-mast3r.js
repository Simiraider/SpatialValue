import { Client, handle_file } from '@gradio/client';
import {
  MAX_GLB_BYTES,
  abrirObjeto,
  actualizarFila,
  marcarDemo,
  marcarError,
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

export const mast3rConfigurado = () =>
  String(process.env.MAST3R_DESHABILITADO || '').trim() !== '1';

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

  const envio = client.submit(
    API_MAST3R,
    {
      inputfiles: cuadros,
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

  const datos = Array.isArray(salida) ? salida : [];
  const modelo = datos[1] || datos[0];
  const url = typeof modelo === 'string' ? modelo : modelo?.url;
  if (!url) throw new Error('MASt3R no devolvió un modelo 3D.');
  return url;
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

    const glbUrl = await conLimite(
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

    const respuesta = await fetch(glbUrl, { signal: AbortSignal.timeout(120_000) });
    if (!respuesta.ok) throw new Error(`No se pudo descargar el modelo (HTTP ${respuesta.status}).`);

    const glbBytes = new Uint8Array(await respuesta.arrayBuffer());
    if (!glbBytes.length) throw new Error('MASt3R devolvió un archivo vacío.');
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
    if (e?.tiempoAgotado) {
      return marcarDemo(
        trabajoId,
        'El motor 3D (MASt3R) no terminó en 3 minutos y mostramos el modelo de demostración.'
      );
    }
    return marcarError(trabajoId, motivo);
  } finally {
    clearInterval(latido);
  }
}
