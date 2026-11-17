import {
  borrarFila,
  borrarObjetos,
  listarTrabajosExpirados,
  visorOperativo,
} from '../../../Backend/visor-supabase.js';
import { limpiarOrdenesViejas } from '../../../Backend/pagos.js';
import { respuestaJson } from '../../../Backend/seguridad.js';
import { igualSeguro } from '../../../Backend/sesion.js';

export const prerender = false;

export async function GET({ request }) {
  const secreto = String(process.env.CRON_SECRET || '').trim();
  const autorizacion = request.headers.get('authorization');

  if (!secreto || !igualSeguro(autorizacion, `Bearer ${secreto}`)) {
    return respuestaJson(401, { ok: false, error: 'No autorizado.' });
  }

  if (!visorOperativo()) {
    return respuestaJson(503, { ok: false, error: 'Supabase no está operativo.' });
  }

  try {
    const filas = await listarTrabajosExpirados(100);
    let borrados = 0;

    for (const fila of filas) {
      try {
        const rutas = [
          ...(Array.isArray(fila.media_paths) ? fila.media_paths : []),
          fila.modelo_path,
        ].filter(Boolean);

        if (rutas.length) await borrarObjetos(rutas);
        await borrarFila(fila.id);
        borrados += 1;
      } catch {
        void 0;
      }
    }

    const pagosBorrados = await limpiarOrdenesViejas().catch(() => 0);

    return respuestaJson(200, { ok: true, borrados, pagosBorrados });
  } catch (e) {
    return respuestaJson(502, {
      ok: false,
      error: e instanceof Error ? e.message : 'No se pudieron limpiar los trabajos vencidos.',
    });
  }
}
