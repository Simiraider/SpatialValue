import {
  consultarEstado,
  guardarModeloExterno,
  responder,
} from '../../Backend/gemelo-servidor.js';

export const prerender = false;

/**
 * POST /api/modelos — vincula un .glb ya existente ("ya tengo un modelo 3D").
 * No consume créditos: solo guarda el archivo.
 */
export async function POST({ request, url }) {
  try {
    const form = await request.formData();
    const archivo = form.get('modelo');
    if (!archivo || typeof archivo === 'string') {
      return responder(400, { error: 'Falta el archivo .glb.' });
    }
    if (archivo.size > 120 * 1024 * 1024) {
      return responder(413, { error: 'El modelo supera los 120 MB.' });
    }
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const id = await guardarModeloExterno({
      bytes,
      titulo: url.searchParams.get('titulo') || 'Modelo 3D externo',
      idUsuario: url.searchParams.get('id_usuario') || null,
      idPublicacion: url.searchParams.get('id_publicacion') || null,
    });
    const estado = await consultarEstado(id);
    return responder(200, estado);
  } catch (e) {
    return responder(500, { error: e instanceof Error ? e.message : 'No se pudo guardar el modelo.' });
  }
}