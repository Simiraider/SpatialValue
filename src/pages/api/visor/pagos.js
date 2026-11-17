import {
  crearOrden,
  crearPreferencia,
  modoPagos,
  ordenPublica,
  ultimaOrdenUtil,
} from '../../../Backend/pagos.js';
import { exigirSesion, limitar, origenDe, respuestaJson } from '../../../Backend/seguridad.js';
import { kiriConfigurado } from '../../../Backend/visor-kiri.js';

export const prerender = false;

export async function GET({ request }) {
  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`pago-resumen:${sesion.usuarioId}`, 120, 60_000))) {
    return respuestaJson(429, { error: 'Demasiadas consultas. Esperá un momento.' });
  }

  const modo = modoPagos();
  if (modo === 'deshabilitado') {
    return respuestaJson(503, { error: 'El pago del modelo 3D no está habilitado todavía.' });
  }

  try {
    const orden = await ultimaOrdenUtil(sesion.usuarioId);
    if (!orden) {
      return respuestaJson(404, { error: 'No hay pagos pendientes.' });
    }
    return respuestaJson(200, {
      ...ordenPublica(orden),
      metodos: obtenerMetodosHabilitados(),
    });
  } catch (e) {
    return respuestaJson(502, {
      error: e instanceof Error ? e.message : 'No se pudo consultar el pago.',
    });
  }
}

export async function POST({ request }) {
  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`pago-visualizador:${sesion.usuarioId}`, 10, 3_600_000))) {
    return respuestaJson(429, { error: 'Demasiados intentos de pago. Probá más tarde.' });
  }

  const modo = modoPagos();
  if (modo === 'deshabilitado') {
    return respuestaJson(503, { error: 'El pago del modelo 3D no está habilitado todavía.' });
  }

  // En modo demo, permitimos avanzar aunque el token no sea legible
  if (modo === 'demo') {
    // Log para debuggear si el token llega al servidor
    console.log('Modo Demo: Validando token HF...', process.env.HF_TOKEN ? 'Detectado' : 'NO DETECTADO');
  } else {
    const motorListo = Boolean(process.env.HF_TOKEN);
    if (!motorListo) {
      return respuestaJson(503, {
        error: 'El motor de IA (MASt3R) no está configurado. No se te cobró nada.',
      });
    }
  }

  const origen = modo === 'mercadopago' ? origenDe(request) : null;
  if (modo === 'mercadopago' && !origen) {
    return respuestaJson(500, { error: 'Falta configurar APP_ORIGIN para cobrar el modelo 3D.' });
  }

  try {
    const orden = await crearOrden({ usuarioId: sesion.usuarioId, modo });

    if (modo === 'demo') {
      return respuestaJson(200, ordenPublica(orden));
    }

    const preferencia = await crearPreferencia(orden, origen);

    return respuestaJson(200, { ...ordenPublica(orden), initPoint: preferencia.initPoint });
  } catch (e) {
    return respuestaJson(502, {
      error: e instanceof Error ? e.message : 'No se pudo iniciar el pago del modelo 3D.',
    });
  }
}
