import { actualizarFila, leerFila, visorOperativo } from './visor-supabase.js';

export async function vincularTrabajoAUsuario({ trabajoId, publicacionId, usuarioId }) {
  if (!visorOperativo() || !trabajoId || !publicacionId || !usuarioId) return false;

  try {
    const fila = await leerFila(trabajoId);
    if (!fila) return false;

    if (fila.usuario_id && String(fila.usuario_id) !== String(usuarioId)) return false;
    if (
      !fila.usuario_id &&
      fila.publicacion_id &&
      String(fila.publicacion_id) !== String(publicacionId)
    ) {
      return false;
    }

    await actualizarFila(trabajoId, {
      publicacion_id: publicacionId,
      usuario_id: fila.usuario_id || usuarioId,
    });

    return true;
  } catch {
    return false;
  }
}
