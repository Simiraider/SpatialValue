import {
  consultarPago,
  firmaWebhookValida,
  leerOrden,
  marcarPagada,
  pagoAprobado,
} from '../../../../Backend/pagos.js';
import { esUuid, respuestaJson } from '../../../../Backend/seguridad.js';

export const prerender = false;

async function datosDePago(request, url) {
  const tipo = url.searchParams.get('type') || url.searchParams.get('topic') || '';
  let id = url.searchParams.get('data.id') || url.searchParams.get('id') || '';

  if (!id) {
    const cuerpo = await request.json().catch(() => null);
    id = String(cuerpo?.data?.id || cuerpo?.id || '');
    if (!tipo) {
      const tipoCuerpo = String(cuerpo?.type || cuerpo?.topic || '');
      return { tipo: tipoCuerpo, id };
    }
  }

  return { tipo, id };
}

export async function POST({ request, url }) {
  try {
    const { tipo, id } = await datosDePago(request, url);
    if (tipo !== 'payment' || !id) return respuestaJson(200, { ok: true });
    if (!firmaWebhookValida(request, id)) {
      return respuestaJson(401, { ok: false, error: 'Firma inválida.' });
    }

    const pago = await consultarPago(id);
    const referencia = String(pago?.external_reference || '');
    if (!pago || !esUuid(referencia)) return respuestaJson(200, { ok: true });

    const orden = await leerOrden(referencia);
    if (!orden || !pagoAprobado(pago, orden)) return respuestaJson(200, { ok: true });

    await marcarPagada(orden.id, String(pago.id));
    return respuestaJson(200, { ok: true });
  } catch {
    return respuestaJson(200, { ok: true });
  }
}
