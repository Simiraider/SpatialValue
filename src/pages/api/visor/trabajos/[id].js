import {
  MAX_MEDIA_BYTES,
  MAX_TOTAL_BYTES,
  actualizarFila,
  borrarFila,
  borrarObjetos,
  errorConfiguracion,
  estadoDesdeFila,
  inspeccionarObjeto,
  leerFila,
  responderJson,
  visorOperativo,
} from '../../../../Backend/visor-supabase.js';
import { kiriConfigurado, sincronizarConKiri } from '../../../../Backend/visor-kiri.js';
import { liberarOrden } from '../../../../Backend/pagos.js';
import { exigirSesion, limitar, puedeAccederTrabajo } from '../../../../Backend/seguridad.js';

export const prerender = false;

const ESPERA_CHEQUEO_MS = 10_000;

const noConfigurado = () => responderJson(503, { error: errorConfiguracion() });

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

export async function GET({ params, request }) {
  if (!visorOperativo()) return noConfigurado();

  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`visor-estado:${sesion.usuarioId}`, 120, 60_000))) {
    return responderJson(429, { error: 'Demasiadas consultas. Esperá un momento.' });
  }

  try {
    const autorizado = await trabajoAutorizado(params.id, sesion.usuarioId);
    if (autorizado.error) return autorizado.error;
    let fila = autorizado.fila;

    const enKiri =
      fila.estado === 'procesando' && fila.proveedor === 'kiri' && fila.proveedor_ref;

    if (enKiri) {
      const ultimo = fila.chequeo_en ? Date.parse(fila.chequeo_en) : 0;
      const tocaChequear = !Number.isFinite(ultimo) || Date.now() - ultimo > ESPERA_CHEQUEO_MS;

      if (tocaChequear) {
        await actualizarFila(fila.id, { chequeo_en: new Date().toISOString() }).catch(() => null);
        try {
          fila = await sincronizarConKiri(fila);
        } catch (e) {
          const mensaje = e instanceof Error ? e.message : 'error de red';
          fila =
            (await actualizarFila(fila.id, {
              mensaje: `Reintentando con KIRI: ${mensaje}`,
            }).catch(() => null)) || fila;
        }
      }
    }

    return responderJson(200, estadoDesdeFila(fila));
  } catch (e) {
    return responderJson(500, {
      error: e instanceof Error ? e.message : 'No se pudo consultar el trabajo.',
    });
  }
}

export async function POST({ params, request }) {
  if (!visorOperativo()) return noConfigurado();

  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`visor-confirmar:${sesion.usuarioId}`, 120, 3_600_000))) {
    return responderJson(429, { error: 'Demasiadas confirmaciones. Esperá un momento.' });
  }

  let cuerpo = null;
  try {
    cuerpo = await request.json();
  } catch {
    cuerpo = null;
  }
  if (cuerpo?.accion !== 'subida_completa') {
    return responderJson(400, { error: 'Acción no reconocida.' });
  }

  try {
    const autorizado = await trabajoAutorizado(params.id, sesion.usuarioId);
    if (autorizado.error) return autorizado.error;
    const fila = autorizado.fila;

    const rutas = Array.isArray(fila.media_paths) ? fila.media_paths : [];
    if (!rutas.length) {
      return responderJson(409, { error: 'El trabajo no tiene archivos registrados.' });
    }

    let total = 0;
    for (const ruta of rutas) {
      const { existe, bytes } = await inspeccionarObjeto(ruta);
      if (!existe) {
        return responderJson(409, {
          error: `Falta subir ${String(ruta).split('/').pop()} a Supabase Storage.`,
        });
      }
      if (bytes > MAX_MEDIA_BYTES) {
        return responderJson(413, {
          error: `${String(ruta).split('/').pop()} supera el máximo de ${Math.round(
            MAX_MEDIA_BYTES / 1024 / 1024
          )} MB.`,
        });
      }
      total += bytes;
      if (total > MAX_TOTAL_BYTES) {
        return responderJson(413, {
          error: `El material supera el máximo total de ${Math.round(
            MAX_TOTAL_BYTES / 1024 / 1024
          )} MB.`,
        });
      }
    }

    const actualizada = await actualizarFila(params.id, {
      estado: 'subido',
      etapa: 'reconstruyendo',
      progreso: 90,
      mensaje:
        'Material guardado en Supabase. Falta vincular el modelo .glb para verlo en 3D.',
      error: null,
    });

    return responderJson(200, {
      ...estadoDesdeFila(actualizada),
      enviar: kiriConfigurado(),
    });
  } catch (e) {
    return responderJson(500, {
      error: e instanceof Error ? e.message : 'No se pudo confirmar la subida.',
    });
  }
}

export async function DELETE({ params, request }) {
  if (!visorOperativo()) return noConfigurado();

  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`visor-borrar:${sesion.usuarioId}`, 30, 3_600_000))) {
    return responderJson(429, { error: 'Demasiadas cancelaciones. Esperá un momento.' });
  }

  try {
    const autorizado = await trabajoAutorizado(params.id, sesion.usuarioId);
    if (autorizado.error) return autorizado.error;
    const fila = autorizado.fila;

    const rutas = [
      ...(Array.isArray(fila.media_paths) ? fila.media_paths : []),
      fila.modelo_path,
    ].filter(Boolean);

    await borrarObjetos(rutas);
    await borrarFila(params.id);

    if (fila.estado !== 'listo') {
      await liberarOrden(params.id).catch(() => {});
    }

    return responderJson(200, { ok: true });
  } catch (e) {
    return responderJson(500, {
      error: e instanceof Error ? e.message : 'No se pudo cancelar el trabajo.',
    });
  }
}
