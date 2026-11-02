import {
  actualizarFila,
  errorConfiguracion,
  estadoDesdeFila,
  leerFila,
  responderJson,
  visorOperativo,
} from '../../../../../Backend/visor-supabase.js';
import { enviarAKiri, kiriConfigurado, sincronizarConKiri } from '../../../../../Backend/visor-kiri.js';

export const prerender = false;

export async function POST({ params }) {
  if (!visorOperativo()) {
    return responderJson(503, { error: errorConfiguracion() });
  }

  try {
    const fila = await leerFila(params.id);
    if (!fila) return responderJson(404, { error: 'Trabajo no encontrado.' });

    if (fila.estado === 'listo') return responderJson(200, estadoDesdeFila(fila));

    if (fila.proveedor === 'kiri' && fila.proveedor_ref) {
      const actualizada = await sincronizarConKiri(fila).catch(() => fila);
      return responderJson(200, estadoDesdeFila(actualizada));
    }

    if (!kiriConfigurado()) {
      return responderJson(409, {
        error:
          'Falta KIRI_API_KEY. Mientras tanto podés vincular un .glb desde el panel del visor.',
      });
    }

    const rutas = Array.isArray(fila.media_paths) ? fila.media_paths : [];
    if (!rutas.length) {
      return responderJson(409, { error: 'El trabajo no tiene archivos para enviar.' });
    }
    if (rutas.length > 1 && fila.es_video) {
      return responderJson(409, { error: 'KIRI espera un solo video por trabajo.' });
    }

    await actualizarFila(fila.id, {
      mensaje: 'Enviando el material a KIRI…',
      progreso: 15,
    });

    const referencia = await enviarAKiri(fila);

    const actualizada = await actualizarFila(fila.id, {
      estado: 'procesando',
      etapa: 'reconstruyendo',
      progreso: 35,
      mensaje: 'En cola de procesamiento en KIRI…',
      proveedor: 'kiri',
      proveedor_ref: referencia,
      error: null,
    });

    return responderJson(200, estadoDesdeFila(actualizada));
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'No se pudo enviar el material a KIRI.';

    try {
      await actualizarFila(params.id, {
        mensaje: `No se pudo enviar a KIRI: ${mensaje}`,
        progreso: 90,
      });
    } catch {
      void 0;
    }

    return responderJson(502, { error: mensaje });
  }
}
