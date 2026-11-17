import { borrarFila, consultarEstado, leerFila, responder } from '../../../Backend/gemelo-servidor.js';
import { exigirSesion, limitar, puedeAccederTrabajoGemelo } from '../../../Backend/seguridad.js';

export const prerender = false;

async function autorizado(id, usuarioId) {
  const fila = await leerFila(id);
  if (!fila) return { error: responder(404, { error: 'Trabajo no encontrado.' }) };
  if (!(await puedeAccederTrabajoGemelo(fila, usuarioId))) {
    return { error: responder(403, { error: 'No tenés permiso para acceder a este trabajo.' }) };
  }
  return { fila };
}

export async function GET({ params, request }) {
  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`gemelo-estado:${sesion.usuarioId}`, 120, 60_000))) {
    return responder(429, { error: 'Demasiadas consultas. Esperá un momento.' });
  }

  try {
    const check = await autorizado(params.id, sesion.usuarioId);
    if (check.error) return check.error;

    const estado = await consultarEstado(params.id);
    if (!estado) return responder(404, { error: 'Trabajo no encontrado.' });
    return responder(200, estado);
  } catch (e) {
    return responder(500, { error: e instanceof Error ? e.message : 'Error consultando el trabajo.' });
  }
}

export async function DELETE({ params, request }) {
  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`gemelo-borrar:${sesion.usuarioId}`, 30, 3_600_000))) {
    return responder(429, { error: 'Demasiadas cancelaciones. Esperá un momento.' });
  }

  try {
    const check = await autorizado(params.id, sesion.usuarioId);
    if (check.error) return check.error;

    await borrarFila(params.id);
    return responder(200, { ok: true });
  } catch (e) {
    return responder(500, { error: e instanceof Error ? e.message : 'No se pudo cancelar.' });
  }
}
