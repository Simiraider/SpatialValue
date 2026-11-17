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
import {
  descargarRemoto,
  exigirSesion,
  limitar,
  puedeAccederTrabajo,
} from '../../../../../Backend/seguridad.js';

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

async function trabajoAutorizado(id, usuarioId) {
  const fila = await leerFila(id);
  if (!fila) {
    return { error: responderJson(404, { error: 'Trabajo no encontrado.' }) };
  }
  if (!(await puedeAccederTrabajo(fila, usuarioId))) {
    return { error: responderJson(403, { error: 'No tenés permiso para acceder a este trabajo.' }) };
  }
  return { fila };
}

export async function POST({ params, request }) {
  if (!visorOperativo()) return noConfigurado();

  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`visor-modelo:${sesion.usuarioId}`, 20, 3_600_000))) {
    return responderJson(429, { error: 'Demasiados intentos. Probá más tarde.' });
  }

  let cuerpo = null;
  try {
    cuerpo = await request.json();
  } catch {
    cuerpo = null;
  }

  try {
    const autorizado = await trabajoAutorizado(params.id, sesion.usuarioId);
    if (autorizado.error) return autorizado.error;
    const fila = autorizado.fila;

    if (cuerpo?.firmar) {
      const ruta = rutaModelo(fila.id);
      const { url } = await firmarSubida(ruta);
      return responderJson(200, { path: ruta, url });
    }

    const glbUrl = String(cuerpo?.glb_url || '').trim();
    if (!glbUrl) {
      return responderJson(400, {
        error: 'Pasá una URL https del .glb o subí el archivo con el modo de subida directa.',
      });
    }

    const descarga = await descargarRemoto(glbUrl, {
      maxBytes: MAX_GLB_BYTES,
      timeoutMs: 50_000,
    });

    if (!descarga.ok) {
      return responderJson(descarga.status === 413 ? 413 : 502, { error: descarga.error });
    }

    const bytes = descarga.bytes;

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

  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`visor-confirmar-modelo:${sesion.usuarioId}`, 60, 3_600_000))) {
    return responderJson(429, { error: 'Demasiados intentos. Probá más tarde.' });
  }

  let cuerpo = null;
  try {
    cuerpo = await request.json();
  } catch {
    cuerpo = null;
  }

  try {
    const autorizado = await trabajoAutorizado(params.id, sesion.usuarioId);
    if (autorizado.error) return autorizado.error;
    const fila = autorizado.fila;

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
