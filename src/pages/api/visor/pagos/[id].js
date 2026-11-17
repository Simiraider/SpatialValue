import {
  buscarPagoAprobado,
  leerOrden,
  marcarPagada,
  pagoAprobado,
} from '../../../../Backend/pagos.js';
import { exigirSesion, limitar, respuestaJson } from '../../../../Backend/seguridad.js';

export const prerender = false;

async function ordenDelUsuario(id, usuarioId) {
  const orden = await leerOrden(id);
  if (!orden || String(orden.usuario_id) !== String(usuarioId)) return null;
  return orden;
}

export async function GET({ params, request }) {
  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`pago-estado:${sesion.usuarioId}`, 120, 60_000))) {
    return respuestaJson(429, { error: 'Demasiadas consultas. Esperá un momento.' });
  }

  try {
    const orden = await ordenDelUsuario(params.id, sesion.usuarioId);
    if (!orden) return respuestaJson(404, { error: 'Pago no encontrado.' });

    return respuestaJson(200, {
      id: orden.id,
      estado: orden.estado,
      montoUsd: Number(orden.monto_usd),
    });
  } catch (e) {
    return respuestaJson(502, {
      error: e instanceof Error ? e.message : 'No se pudo consultar el pago.',
    });
  }
}

export async function POST({ params, request }) {
  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`pago-verificar:${sesion.usuarioId}`, 30, 3_600_000))) {
    return respuestaJson(429, { error: 'Demasiadas verificaciones. Esperá un momento.' });
  }

  try {
    const orden = await ordenDelUsuario(params.id, sesion.usuarioId);
    if (!orden) return respuestaJson(404, { error: 'Pago no encontrado.' });

    if (orden.estado === 'pagado') {
      return respuestaJson(200, { id: orden.id, estado: 'pagado', montoUsd: Number(orden.monto_usd) });
    }

    if (orden.proveedor !== 'mercadopago') {
      return respuestaJson(200, { id: orden.id, estado: orden.estado, montoUsd: Number(orden.monto_usd) });
    }

    const pago = await buscarPagoAprobado(orden.id);
    if (pago && pagoAprobado(pago, orden)) {
      await marcarPagada(orden.id, String(pago.id));
      return respuestaJson(200, { id: orden.id, estado: 'pagado', montoUsd: Number(orden.monto_usd) });
    }

    return respuestaJson(200, { id: orden.id, estado: 'pendiente', montoUsd: Number(orden.monto_usd) });
  } catch (e) {
    return respuestaJson(502, {
      error: e instanceof Error ? e.message : 'No se pudo verificar el pago.',
    });
  }
}
