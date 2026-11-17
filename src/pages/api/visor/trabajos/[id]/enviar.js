import {
  actualizarFila,
  errorConfiguracion,
  estadoDesdeFila,
  leerFila,
  reclamarEnvio,
  responderJson,
  visorOperativo,
} from '../../../../../Backend/visor-supabase.js';
import {
  sincronizarConMASt3R,
} from '../../../../../Backend/visor-kiri.js';
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

    // Si ya hay un proceso de MASt3R, sincronizamos
    if (fila.proveedor === 'mast3r' && fila.proveedor_ref) {
      const actualizada = await sincronizarConMASt3R(fila).catch(() => fila);
      return responderJson(200, estadoDesdeFila(actualizada));
    }

    // Procesamos los archivos directamente con MASt3R
    const formData = await request.formData();
    const archivos = [];
    
    // Buscamos todos los archivos subidos (frames del video o fotos)
    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        archivos.push(value);
      }
    }

    if (archivos.length === 0) {
      return responderJson(400, { error: 'No se enviaron archivos para procesar.' });
    }

    // Marcamos como enviando para evitar duplicados
    const reclamada = await reclamarEnvio(fila.id);
    if (!reclamada) {
      return responderJson(409, { error: 'Este trabajo ya se está procesando.' });
    }

    try {
      // Actualizamos el estado para que el usuario vea que empezó la IA
      await actualizarFila(fila.id, {
        estado: 'procesando',
        mensaje: 'Enviando datos a la IA y analizando escena...',
        progreso: 30,
      });

      // Ejecutamos el proceso de reconstrucción 3D
      await procesarConMASt3R(fila.id, archivos);
      
      const actualizada = await leerFila(params.id);
      return responderJson(200, estadoDesdeFila(actualizada));
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : 'Error en la reconstrucción 3D.';
      await actualizarFila(fila.id, {
        estado: 'subido',
        mensaje: `MASt3R: ${mensaje}`,
        progreso: 90,
      }).catch(() => {});
      return responderJson(502, { error: mensaje });
    }
  } catch (e) {
    return responderJson(502, {
      error: e instanceof Error ? e.message : 'No se pudo procesar el gemelo digital.',
    });
  }
}