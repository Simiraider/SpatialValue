import {
  errorConfiguracion,
  estadoDesdeFila,
  leerFila,
  marcarDemo,
  reclamarEnvio,
  responderJson,
  visorOperativo,
} from '../../../../../Backend/visor-supabase.js';
import { procesarConMASt3R } from '../../../../../Backend/visor-mast3r.js';
import { exigirSesion, limitar, puedeAccederTrabajo } from '../../../../../Backend/seguridad.js';

export const prerender = false;

export async function POST({ params, request }) {
  if (!visorOperativo()) {
    return responderJson(503, { error: errorConfiguracion() });
  }

  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`visor-enviar:${sesion.usuarioId}`, 5, 3_600_000))) {
    return responderJson(429, { error: 'Demasiadas solicitudes. Esperá un momento.' });
  }

  try {
    const fila = await leerFila(params.id);
    if (!fila) return responderJson(404, { error: 'Trabajo no encontrado.' });
    if (!(await puedeAccederTrabajo(fila, sesion.usuarioId))) {
      return responderJson(403, { error: 'No tenés permiso para enviar este trabajo.' });
    }

    if (fila.estado === 'listo') return responderJson(200, estadoDesdeFila(fila));

    if (fila.estado === 'enviando' || fila.estado === 'procesando') {
      return responderJson(200, {
        ...estadoDesdeFila(fila),
        mensaje: 'El modelo ya se está procesando. Esperá unos minutos.',
      });
    }

    const rutas = Array.isArray(fila.media_paths) ? fila.media_paths.filter(Boolean) : [];
    if (!rutas.length) {
      return responderJson(409, { error: 'El trabajo no tiene fotos registradas para procesar.' });
    }

    const reclamada = await reclamarEnvio(fila.id);
    if (!reclamada) {
      return responderJson(409, { error: 'Este trabajo ya se está procesando.' });
    }

    const actualizada = await procesarConMASt3R(fila.id, rutas);
    return responderJson(200, estadoDesdeFila(actualizada));
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'No se pudo procesar el gemelo digital.';
    await marcarDemo(params.id, mensaje).catch(() => {});
    return responderJson(502, { error: mensaje });
  }
}
