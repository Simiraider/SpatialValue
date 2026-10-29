import {
  MAX_GLB_BYTES,
  actualizarFila,
  errorConfiguracion,
  estadoDesdeFila,
  firmarSubida,
  inspeccionarObjeto,
  leerFila,
  responderJson,
  rutaModelo,
  subirObjeto,
  visorOperativo,
} from '../../../../../Backend/visor-supabase.js';

export const prerender = false;

const noConfigurado = () => responderJson(503, { error: errorConfiguracion() });

const esGlb = (bytes) =>
  bytes.length >= 4 &&
  bytes[0] === 0x67 &&
  bytes[1] === 0x6c &&
  bytes[2] === 0x54 &&
  bytes[3] === 0x46;

async function marcarListo(fila, bytes) {
  const actualizada = await actualizarFila(fila.id, {
    estado: 'listo',
    etapa: 'listo',
    progreso: 100,
    mensaje: 'Modelo 3D listo',
    modelo_path: rutaModelo(fila.id),
    modelo_bytes: bytes,
    error: null,
  });
  return estadoDesdeFila(actualizada);
}

export async function POST({ params, request }) {
  if (!visorOperativo()) return noConfigurado();

  let cuerpo = null;
  try {
    cuerpo = await request.json();
  } catch {
    cuerpo = null;
  }

  try {
    const fila = await leerFila(params.id);
    if (!fila) return responderJson(404, { error: 'Trabajo no encontrado.' });

    if (cuerpo?.firmar) {
      const ruta = rutaModelo(fila.id);
      const { url } = await firmarSubida(ruta);
      return responderJson(200, { path: ruta, url });
    }

    const glbUrl = String(cuerpo?.glb_url || '').trim();
    if (!/^https?:\/\//i.test(glbUrl)) {
      return responderJson(400, {
        error: 'Pasá una URL http(s) del .glb o subí el archivo con el modo de subida directa.',
      });
    }

    const remoto = await fetch(glbUrl, { signal: AbortSignal.timeout(120000) });
    if (!remoto.ok) {
      return responderJson(502, {
        error: `No se pudo descargar el modelo (HTTP ${remoto.status}).`,
      });
    }

    const declarado = Number(remoto.headers.get('content-length')) || 0;
    if (declarado > MAX_GLB_BYTES) {
      return responderJson(413, {
        error: `El modelo supera el máximo de ${Math.round(MAX_GLB_BYTES / 1024 / 1024)} MB.`,
      });
    }

    const bytes = new Uint8Array(await remoto.arrayBuffer());
    if (bytes.length > MAX_GLB_BYTES) {
      return responderJson(413, {
        error: `El modelo supera el máximo de ${Math.round(MAX_GLB_BYTES / 1024 / 1024)} MB.`,
      });
    }
    if (!esGlb(bytes)) {
      return responderJson(400, { error: 'El enlace no apunta a un .glb válido.' });
    }

    await subirObjeto(rutaModelo(fila.id), bytes, 'model/gltf-binary');
    return responderJson(200, await marcarListo(fila, bytes.length));
  } catch (e) {
    return responderJson(500, {
      error: e instanceof Error ? e.message : 'No se pudo vincular el modelo.',
    });
  }
}

export async function PUT({ params, request }) {
  if (!visorOperativo()) return noConfigurado();

  let cuerpo = null;
  try {
    cuerpo = await request.json();
  } catch {
    cuerpo = null;
  }

  try {
    const fila = await leerFila(params.id);
    if (!fila) return responderJson(404, { error: 'Trabajo no encontrado.' });

    const ruta = String(cuerpo?.path || '').trim() || rutaModelo(fila.id);
    if (ruta !== rutaModelo(fila.id)) {
      return responderJson(400, { error: 'La ruta no corresponde a este trabajo.' });
    }

    const info = await inspeccionarObjeto(ruta);
    if (!info.existe) {
      return responderJson(409, { error: 'El modelo todavía no está en Supabase Storage.' });
    }
    if (!info.esGlb) {
      return responderJson(400, { error: 'El archivo subido no es un .glb válido.' });
    }
    if (info.bytes > MAX_GLB_BYTES) {
      return responderJson(413, {
        error: `El modelo supera el máximo de ${Math.round(MAX_GLB_BYTES / 1024 / 1024)} MB.`,
      });
    }

    return responderJson(200, await marcarListo(fila, info.bytes));
  } catch (e) {
    return responderJson(500, {
      error: e instanceof Error ? e.message : 'No se pudo confirmar el modelo.',
    });
  }
}
