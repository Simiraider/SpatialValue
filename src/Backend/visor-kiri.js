import { unzipSync } from 'fflate';
import {
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
const MAX_ZIP_BYTES = 400 * 1024 * 1024;

const clave = () => String(process.env.KIRI_API_KEY || '').trim();
export const kiriConfigurado = () => Boolean(clave());
const encabezado = () => ({ Authorization: `Bearer ${clave()}` });
const codificador = new TextEncoder();
const texto = (valor) => codificador.encode(valor);

const calidadKiri = (calidad) =>
  calidad === 'alta' ? '0' : calidad === 'rapida' ? '2' : '1';

const nombreLimpio = (valor) =>
  String(valor || 'archivo').replace(/["\\\r\n]/g, '-').slice(-80) || 'archivo';

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

  const archivos = rutas.map((ruta) => ({
    campo: esVideo ? 'videoFile' : 'imagesFiles',
    nombre:
      String(ruta).split('/').pop()?.replace(/^\d+-/, '') || (esVideo ? 'recorrido.mp4' : 'foto.jpg'),
    tipo: esVideo ? 'video/mp4' : 'image/jpeg',
    abrir: () => abrirObjeto(ruta),
  }));

  const campos = [
    ['fileFormat', 'glb'],
    ['modelQuality', calidadKiri(fila.calidad)],
    ['textureQuality', '1'],
    ['isMask', '1'],
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

  const { esVideo, boundary, contentType, cuerpo } = construirCuerpo(fila);
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
  if (!mejor) throw new Error('El ZIP de KIRI no contiene un archivo .glb.');
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

  const zip = new Uint8Array(await descarga.arrayBuffer());
  if (zip.length > MAX_ZIP_BYTES) {
    throw new Error('El modelo de KIRI es demasiado grande para procesarlo.');
  }

  const glb = extraerGlb(zip);
  await subirObjeto(rutaModelo(fila.id), glb, 'model/gltf-binary');
  return glb.length;
}

const MENSAJES = {
  '-1': [30, 'Subiendo el material a KIRI…'],
  '3': [35, 'En cola de procesamiento en KIRI…'],
  '0': [60, 'Reconstruyendo geometría y textura en KIRI…'],
};

export async function sincronizarConKiri(fila) {
  const estado = await consultarEstadoKiri(fila);

  if (estado === '2') {
    const bytes = await materializarModelo(fila);
    return actualizarFila(fila.id, {
      estado: 'listo',
      etapa: 'listo',
      progreso: 100,
      mensaje: 'Modelo 3D listo',
      modelo_path: rutaModelo(fila.id),
      modelo_bytes: bytes,
      error: null,
    });
  }

  if (estado === '1' || estado === '4') {
    const mensaje =
      estado === '4'
        ? 'La reconstrucción expiró en KIRI. Volvé a generarla con un recorrido más corto.'
        : 'KIRI no pudo reconstruir el modelo. Probá con más solapamiento o mejor luz.';
    return actualizarFila(fila.id, {
      estado: 'error',
      etapa: 'error',
      error: mensaje,
      mensaje,
    });
  }

  const [progreso, mensaje] = MENSAJES[estado] || [55, 'Procesando en KIRI…'];
  return actualizarFila(fila.id, {
    estado: 'procesando',
    etapa: 'reconstruyendo',
    progreso,
    mensaje,
  });
}
