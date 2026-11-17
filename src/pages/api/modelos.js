import { consultarEstado, guardarModeloExterno, responder } from '../../Backend/gemelo-servidor.js';
import {
  esPublicacionDelUsuario,
  esUuid,
  exigirSesion,
  limitar,
} from '../../Backend/seguridad.js';

export const prerender = false;

const MAX_GLB_BYTES = 50 * 1024 * 1024;

export async function POST({ request, url }) {
  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`modelo-externo:${sesion.usuarioId}`, 10, 3_600_000))) {
    return responder(429, { error: 'Demasiadas subidas. Probá más tarde.' });
  }

  try {
    const form = await request.formData();
    const archivo = form.get('modelo');
    if (!archivo || typeof archivo === 'string') {
      return responder(400, { error: 'Falta el archivo .glb.' });
    }
    if (archivo.size > MAX_GLB_BYTES) {
      return responder(413, {
        error: `El modelo supera los ${Math.round(MAX_GLB_BYTES / 1024 / 1024)} MB.`,
      });
    }

    const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');
    const idPublicacion =
      texto(form.get('id_publicacion')) || texto(url.searchParams.get('id_publicacion')) || null;

    if (idPublicacion) {
      if (
        !esUuid(idPublicacion) ||
        !(await esPublicacionDelUsuario(sesion.usuarioId, idPublicacion))
      ) {
        return responder(403, { error: 'La publicación no pertenece a tu cuenta.' });
      }
    }

    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const id = await guardarModeloExterno({
      bytes,
      titulo:
        texto(form.get('titulo')).slice(0, 200) ||
        texto(url.searchParams.get('titulo')).slice(0, 200) ||
        'Modelo 3D externo',
      idUsuario: sesion.usuarioId,
      idPublicacion,
    });

    const estado = await consultarEstado(id);
    return responder(200, estado);
  } catch (e) {
    return responder(500, { error: e instanceof Error ? e.message : 'No se pudo guardar el modelo.' });
  }
}
