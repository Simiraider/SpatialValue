import {
  actualizarFila,
  borrarFila,
  borrarObjetos,
  errorConfiguracion,
  estadoDesdeFila,
  inspeccionarObjeto,
  leerFila,
  responderJson,
  visorOperativo,
} from '../../../../Backend/visor-supabase.js';
import { kiriConfigurado, sincronizarConKiri } from '../../../../Backend/visor-kiri.js';

export const prerender = false;

const ESPERA_CHEQUEO_MS = 10_000;

const noConfigurado = () => responderJson(503, { error: errorConfiguracion() });

export async function GET({ params }) {
  if (!visorOperativo()) return noConfigurado();
  try {
    let fila = await leerFila(params.id);
    if (!fila) return responderJson(404, { error: 'Trabajo no encontrado.' });

    const enKiri =
      fila.estado === 'procesando' && fila.proveedor === 'kiri' && fila.proveedor_ref;

    if (enKiri) {
      const ultimo = fila.chequeo_en ? Date.parse(fila.chequeo_en) : 0;
      const tocaChequear = !Number.isFinite(ultimo) || Date.now() - ultimo > ESPERA_CHEQUEO_MS;

      if (tocaChequear) {
        await actualizarFila(fila.id, { chequeo_en: new Date().toISOString() }).catch(() => null);
        try {
          fila = await sincronizarConKiri(fila);
        } catch (e) {
          const mensaje = e instanceof Error ? e.message : 'error de red';
          fila =
            (await actualizarFila(fila.id, {
              mensaje: `Reintentando con KIRI: ${mensaje}`,
            }).catch(() => null)) || fila;
        }
      }
    }

    return responderJson(200, estadoDesdeFila(fila));
  } catch (e) {
    return responderJson(500, {
      error: e instanceof Error ? e.message : 'No se pudo consultar el trabajo.',
    });
  }
}

export async function POST({ params, request }) {
  if (!visorOperativo()) return noConfigurado();

  let cuerpo = null;
  try {
    cuerpo = await request.json();
  } catch {
    cuerpo = null;
  }
  if (cuerpo?.accion !== 'subida_completa') {
    return responderJson(400, { error: 'Acción no reconocida.' });
  }

  try {
    const fila = await leerFila(params.id);
    if (!fila) return responderJson(404, { error: 'Trabajo no encontrado.' });

    const rutas = Array.isArray(fila.media_paths) ? fila.media_paths : [];
    if (!rutas.length) {
      return responderJson(409, { error: 'El trabajo no tiene archivos registrados.' });
    }

    for (const ruta of rutas) {
      const { existe } = await inspeccionarObjeto(ruta);
      if (!existe) {
        return responderJson(409, {
          error: `Falta subir ${String(ruta).split('/').pop()} a Supabase Storage.`,
        });
      }
    }

    const actualizada = await actualizarFila(params.id, {
      estado: 'subido',
      etapa: 'reconstruyendo',
      progreso: 90,
      mensaje:
        'Material guardado en Supabase. Falta vincular el modelo .glb para verlo en 3D.',
      error: null,
    });

    return responderJson(200, {
      ...estadoDesdeFila(actualizada),
      enviar: kiriConfigurado(),
    });
  } catch (e) {
    return responderJson(500, {
      error: e instanceof Error ? e.message : 'No se pudo confirmar la subida.',
    });
  }
}

export async function DELETE({ params }) {
  if (!visorOperativo()) return noConfigurado();
  try {
    const fila = await leerFila(params.id);
    if (fila) {
      const rutas = [
        ...(Array.isArray(fila.media_paths) ? fila.media_paths : []),
        fila.modelo_path,
      ].filter(Boolean);
      await borrarObjetos(rutas);
      await borrarFila(params.id);
    }
    return responderJson(200, { ok: true });
  } catch (e) {
    return responderJson(500, {
      error: e instanceof Error ? e.message : 'No se pudo cancelar el trabajo.',
    });
  }
}
