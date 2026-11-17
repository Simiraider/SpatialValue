import { unzipSync } from 'fflate';
import {
  MAX_GLB_BYTES,
  abrirObjeto,
  actualizarFila,
  rutaModelo,
  subirObjeto,
} from './visor-supabase.js';

const API_KIRI_POR_DEFECTO = 'https://api.kiriengine.app/api/v1/open';

const apiKiri = () =>
  String(process.env.KIRI_API_URL || API_KIRI_POR_DEFECTO).trim().replace(/\/+$/, '');

export const LIMITE_ENVIO_MS = 55_000;
const LIMITE_ESTADO_MS = 20_000;
const LIMITE_MODELO_MS = 45_000;
const MAX_ZIP_BYTES = 120 * 1024 * 1024;

const clave = () => String(process.env.KIRI_API_KEY || '').trim();
export const kiriConfigurado = () => Boolean(clave());
const encabezado = () => ({ Authorization: `Bearer ${clave()}` });
const codificador = new TextEncoder();
const texto = (valor) => codificador.encode(valor);

const calidadKiri = (calidad) =>
  calidad === 'alta' ? '0' : calidad === 'rapida' ? '2' : '1';

const nombreLimpio = (valor) =>
  String(valor || 'archivo').replace(/["\\\r\n]/g, '-').slice(-80) || 'archivo';

const extension = (nombre) =>
  String(nombre || '')
    .split('.')
    .pop()
    ?.toLowerCase() || '';

const tipoVideo = (nombre) => {
  const ext = extension(nombre);
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'm4v') return 'video/x-m4v';
  return 'video/mp4';
};

const tipoImagen = (nombre) => {
  const ext = extension(nombre);
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  if (ext === 'avif') return 'image/avif';
  return 'image/jpeg';
};

export function partesMultipart({ boundary, archivos, campos }) {
  const partes = [];

  for (const archivo of archivos) {
    partes.push(
      texto(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${archivo.campo}"; filename="${nombreLimpio(archivo.nombre)}"\r\n` +
          `Content-Type: ${archivo.tipo}\r\n\r\n`
      )
    );
    partes.push({ nombre: archivo.nombre, abrir: archivo.abrir });
    partes.push(texto('\r\n'));
  }

  for (const [nombre, valor] of campos) {
    partes.push(
      texto(
        `--${boundary}\r\nContent-Disposition: form-data; name="${nombre}"\r\n\r\n${valor}\r\n`
      )
    );
  }

  partes.push(texto(`--${boundary}--\r\n`));
  return partes;
}

export function flujoDesdePartes(partes) {
  let indice = 0;
  let lector = null;

  return new ReadableStream({
    async pull(controlador) {
      for (;;) {
        if (lector) {
          const { done, value } = await lector.read();
          if (done) {
            lector = null;
            continue;
          }
          controlador.enqueue(value);
          return;
        }

        if (indice >= partes.length) {
          controlador.close();
          return;
        }

        const parte = partes[indice++];
        if (parte instanceof Uint8Array) {
          controlador.enqueue(parte);
          return;
        }

        const respuesta = await parte.abrir();
        if (!respuesta?.ok || !respuesta.body) {
          controlador.error(
            new Error(
              `No se pudo leer ${parte.nombre} de Supabase Storage (HTTP ${respuesta?.status ?? 'sin respuesta'}).`
            )
          );
          return;
        }
        lector = respuesta.body.getReader();
      }
    },
    cancel(motivo) {
      if (lector) lector.cancel(motivo).catch(() => {});
    },
  });
}

function construirCuerpo(fila) {
  const rutas = Array.isArray(fila.media_paths) ? fila.media_paths : [];
  if (!rutas.length) {
    throw new Error('El trabajo no tiene archivos en Supabase Storage.');
  }

  const esVideo = Boolean(fila.es_video);
  const boundary = `----spatialvalue${Date.now().toString(16)}${Math.random()
    .toString(16)
    .slice(2, 8)}`;

  const archivos = rutas.map((ruta) => {
    const nombre =
      String(ruta).split('/').pop()?.replace(/^\d+-/, '') ||
      (esVideo ? 'recorrido.mp4' : 'foto.jpg');
    return {
      campo: esVideo ? 'videoFile' : 'imagesFiles',
      nombre,
      tipo: esVideo ? tipoVideo(nombre) : tipoImagen(nombre),
      abrir: () => abrirObjeto(ruta),
    };
  });

  const campos = [
    ['fileFormat', 'glb'],
    ['modelQuality', calidadKiri(fila.calidad)],
    ['textureQuality', '1'],
    ['isMask', '0'],
    ['textureSmoothing', '0'],
  ];

  return {
    esVideo,
    boundary,
    contentType: `multipart/form-data; boundary=${boundary}`,
    cuerpo: flujoDesdePartes(partesMultipart({ boundary, archivos, campos })),
  };
}

export async function enviarAKiri(fila) {
  if (!kiriConfigurado()) {
    throw new Error('Falta KIRI_API_KEY: el modelo no se puede generar automáticamente.');
  }

  const { esVideo, contentType, cuerpo } = construirCuerpo(fila);
  const destino = `${apiKiri()}/${esVideo ? 'photo/video' : 'photo/image'}`;

  const respuesta = await fetch(destino, {
    method: 'POST',
    headers: { ...encabezado(), 'Content-Type': contentType },
    body: cuerpo,
    duplex: 'half',
    signal: AbortSignal.timeout(LIMITE_ENVIO_MS),
  });

  const detalle = await respuesta.json().catch(() => null);
  if (!respuesta.ok || detalle?.ok !== true) {
    throw new Error(detalle?.msg || `KIRI rechazó el material (HTTP ${respuesta.status}).`);
  }

  const referencia = detalle?.data?.serialize;
  if (!referencia) throw new Error('KIRI no devolvió el identificador del trabajo.');
  return referencia;
}

export async function consultarEstadoKiri(fila) {
  const referencia = fila.proveedor_ref;
  if (!referencia) throw new Error('El trabajo no tiene referencia de KIRI.');

  const respuesta = await fetch(
    `${apiKiri()}/model/getStatus?serialize=${encodeURIComponent(referencia)}`,
    { headers: encabezado(), signal: AbortSignal.timeout(LIMITE_ESTADO_MS) }
  );
  const detalle = await respuesta.json().catch(() => null);
  if (!respuesta.ok || detalle?.ok !== true) {
    throw new Error(detalle?.msg || `KIRI responde HTTP ${respuesta.status}`);
  }
  return String(detalle.data?.status);
}

export function extraerGlb(zip) {
  let excedido = false;
  const archivos = unzipSync(zip, {
    filter: (archivo) => {
      if (!archivo.name.toLowerCase().endsWith('.glb')) return false;
      if (archivo.size > MAX_GLB_BYTES) {
        excedido = true;
        return false;
      }
      return true;
    },
  });
  let mejor = null;
  let mejorTam = 0;
  for (const [nombre, datos] of Object.entries(archivos)) {
    if (!nombre.toLowerCase().endsWith('.glb')) continue;
    if (datos.length > mejorTam) {
      mejor = datos;
      mejorTam = datos.length;
    }
  }
  if (!mejor) {
    if (excedido) {
      throw new Error(
        `El modelo de KIRI supera el máximo de ${Math.round(MAX_GLB_BYTES / 1024 / 1024)} MB.`
      );
    }
    throw new Error('El ZIP de KIRI no contiene un archivo .glb.');
  }
  return mejor;
}

export async function materializarModelo(fila) {
  const referencia = fila.proveedor_ref;
  if (!referencia) throw new Error('El trabajo no tiene referencia de KIRI.');

  const enlace = await fetch(
    `${apiKiri()}/model/getModelZip?serialize=${encodeURIComponent(referencia)}`,
    { headers: encabezado(), signal: AbortSignal.timeout(LIMITE_ESTADO_MS) }
  );
  const detalle = await enlace.json().catch(() => null);
  const urlZip = detalle?.data?.modelUrl;
  if (!enlace.ok || !urlZip) {
    throw new Error(detalle?.msg || 'KIRI no devolvió el enlace del modelo.');
  }

  const descarga = await fetch(urlZip, { signal: AbortSignal.timeout(LIMITE_MODELO_MS) });
  if (!descarga.ok) throw new Error(`No se pudo descargar el modelo (HTTP ${descarga.status}).`);

  const declarado = Number(descarga.headers.get('content-length')) || 0;
  if (declarado > MAX_ZIP_BYTES) {
    throw new Error('El modelo de KIRI es demasiado grande para procesarlo.');
  }
  if (!descarga.body) throw new Error('KIRI devolvió una respuesta vacía.');

  const lector = descarga.body.getReader();
  const trozos = [];
  let total = 0;

  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ZIP_BYTES) {
      await lector.cancel().catch(() => {});
      throw new Error('El modelo de KIRI es demasiado grande para procesarlo.');
    }
    trozos.push(value);
  }

  const zip = new Uint8Array(total);
  let desplazamiento = 0;
  for (const trozo of trozos) {
    zip.set(trozo, desplazamiento);
    desplazamiento += trozo.byteLength;
  }

  const glb = extraerGlb(zip);
  if (glb.length > MAX_GLB_BYTES) {
    throw new Error(
      `El modelo de KIRI supera el máximo de ${Math.round(MAX_GLB_BYTES / 1024 / 1024)} MB.`
    );
  }
  await subirObjeto(rutaModelo(fila.id), glb, 'model/gltf-binary');
  return glb.length;
}

export async function consultarSaldoKiri() {
  if (!kiriConfigurado()) return null;

  try {
    const respuesta = await fetch(`${apiKiri()}/balance`, {
      headers: encabezado(),
      signal: AbortSignal.timeout(LIMITE_ESTADO_MS),
    });
    const detalle = await respuesta.json().catch(() => null);
    if (!respuesta.ok || detalle?.ok !== true) return null;
    const saldo = Number(detalle?.data?.balance);
    return Number.isFinite(saldo) ? saldo : null;
  } catch {
    return null;
  }
}

const MENSAJES = {
  '-1': [30, 'Subiendo el material a KIRI…'],
  '3': [35, 'En cola de procesamiento en KIRI…'],
  '0': [60, 'Reconstruyendo geometría y textura en KIRI…'],
};

import { procesarConMASt3R } from './visor-mast3r.js';

export async function sincronizarConMASt3R(fila) {
  try {
    // Para MASt3R, el procesamiento es más directo.
    // No hay un estado intermedio de "espera" largo como en KIRI,
    // sino que enviamos los frames y esperamos el GLB.
    
    // Nota: En una implementación real, esto se dispararía desde el endpoint de envío
    // y el estado pasaría a 'listo' al finalizar la llamada a procesarConMASt3R.
    
    if (fila.estado === 'listo') return fila;

    return await actualizarFila(fila.id, {
      estado: 'procesando',
      mensaje: 'Reconstruyendo escena con MASt3R...',
      progreso: 30,
    });
  } catch (e) {
    return actualizarFila(fila.id, {
      estado: 'error',
      error: e instanceof Error ? e.message : 'Error en MASt3R',
    });
  }
}
