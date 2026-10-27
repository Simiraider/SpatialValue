import {
  crearEnKiri,
  crearEnMakeSplat,
  crearSimulado,
  responder,
} from '../../Backend/gemelo-servidor.js';

export const prerender = false;

/**
 * POST /api/jobs — crea un trabajo de reconstrucción.
 *
 * Acepta el mismo multipart que enviaba el worker viejo (los archivos van como
 * `videoFile` / `imagesFiles`, que es lo que espera KIRI), y los metadatos via
 * query string para poder reenviar el cuerpo crudo al proveedor sin cargarlo.
 *
 * Sin credenciales —o si el proveedor no admite esa entrada— se crea un trabajo
 * `simular` que termina con el modelo de demostración: la pantalla nunca queda en negro.
 */
export async function POST({ request, url }) {
  const titulo = url.searchParams.get('titulo') || 'Gemelo digital';
  const idUsuario = url.searchParams.get('id_usuario') || null;
  const idPublicacion = url.searchParams.get('id_publicacion') || null;
  const esVideo = url.searchParams.get('es_video') === '1';
  const nFotos = Number(url.searchParams.get('n_fotos') || 0);
  const base = { titulo, idUsuario, idPublicacion, nFotos, esVideo };

  try {
    const proveedor = import.meta.env.KIRI_API_KEY || process.env.KIRI_API_KEY
      ? 'kiri'
      : import.meta.env.MAKESPLAT_API_KEY || process.env.MAKESPLAT_API_KEY
        ? 'makesplat'
        : null;

    let fila = null;
    let motivo = null;

    if (proveedor === 'kiri') fila = await crearEnKiri({ request, ...base });
    else if (proveedor === 'makesplat') {
      if (esVideo) fila = await crearEnMakeSplat({ request, ...base });
      else motivo = 'MakeSplat solo procesa video: subí un MP4/MOV o configurá KIRI_API_KEY.';
    } else motivo = 'Sin API key de reconstrucción.';

    if (!fila) fila = await crearSimulado(base, motivo);

    return responder(200, { id: fila.id, motor: fila.motor, error: null });
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'Error desconocido';
    try {
      const fila = await crearSimulado(
        base,
        `Motor 3D no disponible (${mensaje}). Usando el modelo de demostración.`
      );
      return responder(200, { id: fila.id, motor: 'simular', error: null });
    } catch {
      return responder(502, { error: mensaje, id: null });
    }
  }
}