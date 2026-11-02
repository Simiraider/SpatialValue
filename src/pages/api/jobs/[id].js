import { borrarFila, consultarEstado, responder } from '../../../Backend/gemelo-servidor.js';

export const prerender = false;

/** GET /api/jobs/:id — estado del trabajo (cachea el proveedor 30 s). */
export async function GET({ params }) {
  try {
    const estado = await consultarEstado(params.id);
    if (!estado) return responder(404, { error: 'Trabajo no encontrado.' });
    return responder(200, estado);
  } catch (e) {
    return responder(500, { error: e instanceof Error ? e.message : 'Error consultando el trabajo.' });
  }
}

/** DELETE /api/jobs/:id — cancela y borra el trabajo. */
export async function DELETE({ params }) {
  try {
    await borrarFila(params.id);
    return responder(200, { ok: true });
  } catch (e) {
    return responder(500, { error: e instanceof Error ? e.message : 'No se pudo cancelar.' });
  }
}