import {
  crearLinkFirmado,
  errorConfiguracion,
  leerFila,
  visorOperativo,
} from '../../../../Backend/visor-supabase.js';
import { exigirSesion, limitar, puedeAccederTrabajo } from '../../../../Backend/seguridad.js';
import { responderJson } from '../../../../Backend/visor-supabase.js';

export const prerender = false;

export async function GET({ params, request }) {
  if (!visorOperativo()) return responderJson(503, { error: errorConfiguracion() });

  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`visor-glb:${sesion.usuarioId}`, 120, 60_000))) {
    return responderJson(429, { error: 'Demasiadas consultas. Esperá un momento.' });
  }

  try {
    const fila = await leerFila(params.id);
    if (!fila?.modelo_path) return responderJson(404, { error: 'Este trabajo no tiene modelo.' });
    if (!(await puedeAccederTrabajo(fila, sesion.usuarioId))) {
      return responderJson(403, { error: 'No tenés permiso para ver este modelo.' });
    }

    const urlFirmada = await crearLinkFirmado(fila.modelo_path);
    return responderJson(200, { url: urlFirmada });
  } catch (e) {
    return responderJson(500, { error: e instanceof Error ? e.message : 'Error generando link del modelo.' });
  }
}
