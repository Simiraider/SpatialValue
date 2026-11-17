import crypto from 'node:crypto';
import sql from './carga.js';

export const PRECIO_USD = 2;

const TASA_ARS_POR_DEFECTO = 1500;

export const obtenerMetodosHabilitados = () => {
  return {
    mercadopago: Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN),
    paypal: Boolean(process.env.PAYPAL_CLIENT_ID),
    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    applepay: Boolean(process.env.APPLE_PAY_CONFIG),
    googlepay: Boolean(process.env.GOOGLE_PAY_CONFIG),
  };
};

const monedaPagos = () =>
  String(process.env.PAGOS_MONEDA || 'ARS').trim().toUpperCase() === 'USD' ? 'USD' : 'ARS';

const tasaArs = () => {
  const valor = Number(process.env.PAGOS_TASA_ARS_USD);
  return Number.isFinite(valor) && valor > 0 ? valor : TASA_ARS_POR_DEFECTO;
};

const montoEnMoneda = (moneda) =>
  moneda === 'USD' ? PRECIO_USD : Math.round(PRECIO_USD * tasaArs());

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MP_API = 'https://api.mercadopago.com';

let promesaEsquema = null;

async function crearEsquema() {
  await sql`
    CREATE TABLE IF NOT EXISTS "pagos_visor" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "usuario_id" uuid NOT NULL,
      "trabajo_id" text,
      "monto_usd" numeric(10,2) NOT NULL DEFAULT 2,
      "moneda" text NOT NULL DEFAULT 'USD',
      "monto_moneda" numeric(12,2),
      "estado" text NOT NULL DEFAULT 'pendiente',
      "proveedor" text NOT NULL DEFAULT 'demo',
      "proveedor_ref" text,
      "preferencia_id" text,
      "init_point" text,
      "creado_en" timestamptz NOT NULL DEFAULT NOW(),
      "pagado_en" timestamptz
    )
  `;
  await sql`ALTER TABLE "pagos_visor" ADD COLUMN IF NOT EXISTS "init_point" text`;
  await sql`ALTER TABLE "pagos_visor" ADD COLUMN IF NOT EXISTS "preferencia_id" text`;
  await sql`ALTER TABLE "pagos_visor" ADD COLUMN IF NOT EXISTS "moneda" text NOT NULL DEFAULT 'USD'`;
  await sql`ALTER TABLE "pagos_visor" ADD COLUMN IF NOT EXISTS "monto_moneda" numeric(12,2)`;
  await sql`
    CREATE INDEX IF NOT EXISTS "pagos_visor_usuario_idx"
    ON "pagos_visor" ("usuario_id", "creado_en" DESC)
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "pagos_visor_trabajo_idx"
    ON "pagos_visor" ("trabajo_id")
    WHERE "trabajo_id" IS NOT NULL
  `;
}

export function asegurarEsquemaPagos() {
  if (!promesaEsquema) {
    promesaEsquema = crearEsquema().catch((error) => {
      promesaEsquema = null;
      throw error;
    });
  }
  return promesaEsquema;
}

export function modoPagos() {
  const forzado = String(process.env.PAGOS_MODO || '').trim().toLowerCase();
  if (['demo', 'mercadopago', 'deshabilitado'].includes(forzado)) return forzado;
  if (String(process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim()) return 'mercadopago';
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production'
    ? 'deshabilitado'
    : 'demo';
}

const tokenMercadoPago = () => String(process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();

export async function crearOrden({ usuarioId, modo }) {
  await asegurarEsquemaPagos();
  const pagado = modo === 'demo';
  const moneda = modo === 'mercadopago' ? monedaPagos() : 'USD';
  const montoMoneda = montoEnMoneda(moneda);
  const filas = await sql`
    INSERT INTO "pagos_visor" (
      "usuario_id", "monto_usd", "moneda", "monto_moneda", "estado", "proveedor", "pagado_en"
    )
    VALUES (
      ${usuarioId}, ${PRECIO_USD}, ${moneda}, ${montoMoneda}, ${pagado ? 'pagado' : 'pendiente'},
      ${modo}, ${pagado ? new Date() : null}
    )
    RETURNING "id", "usuario_id", "monto_usd", "moneda", "monto_moneda", "estado", "proveedor",
      "creado_en"
  `;
  const fila = filas[0];
  if (!fila) throw new Error('No se pudo crear la orden de pago.');
  return fila;
}

export async function leerOrden(id) {
  if (!UUID_RE.test(String(id || ''))) return null;
  await asegurarEsquemaPagos();
  const filas = await sql`
    SELECT * FROM "pagos_visor" WHERE "id" = ${id}::uuid LIMIT 1
  `;
  return filas[0] || null;
}

export async function marcarPagada(id, referencia) {
  if (!UUID_RE.test(String(id || ''))) return null;
  await asegurarEsquemaPagos();
  const filas = await sql`
    UPDATE "pagos_visor" SET
      "estado" = 'pagado',
      "pagado_en" = COALESCE("pagado_en", NOW()),
      "proveedor_ref" = COALESCE(${referencia || null}, "proveedor_ref")
    WHERE "id" = ${id}::uuid
    RETURNING *
  `;
  return filas[0] || null;
}

export async function guardarPreferencia(id, preferenciaId, initPoint) {
  await asegurarEsquemaPagos();
  await sql`
    UPDATE "pagos_visor" SET
      "preferencia_id" = ${preferenciaId || null},
      "init_point" = ${initPoint || null}
    WHERE "id" = ${id}::uuid
  `;
}

export async function ultimaOrdenUtil(usuarioId) {
  await asegurarEsquemaPagos();
  const filas = await sql`
    SELECT * FROM "pagos_visor"
    WHERE "usuario_id" = ${usuarioId}
      AND "trabajo_id" IS NULL
      AND (
        "estado" = 'pagado'
        OR ("estado" = 'pendiente' AND "creado_en" > NOW() - INTERVAL '2 hours')
      )
    ORDER BY "creado_en" DESC
    LIMIT 1
  `;
  return filas[0] || null;
}

export async function limpiarOrdenesViejas() {
  await asegurarEsquemaPagos();
  const filas = await sql`
    DELETE FROM "pagos_visor"
    WHERE "estado" = 'pendiente'
      AND "trabajo_id" IS NULL
      AND "creado_en" < NOW() - INTERVAL '7 days'
    RETURNING "id"
  `;
  return filas.length;
}

export const ordenPublica = (orden) => ({
  id: orden.id,
  montoUsd: Number(orden.monto_usd),
  moneda: String(orden.moneda || 'USD').toUpperCase(),
  montoMoneda: Number(orden.monto_moneda || orden.monto_usd),
  estado: orden.estado,
  modo: orden.proveedor === 'mercadopago' ? 'mercadopago' : 'demo',
  initPoint: orden.init_point || undefined,
});

export async function reservarOrden(usuarioId, pagoId, trabajoId) {
  if (!UUID_RE.test(String(pagoId || ''))) return false;
  await asegurarEsquemaPagos();
  const filas = await sql`
    UPDATE "pagos_visor" SET "trabajo_id" = ${trabajoId}
    WHERE "id" = ${pagoId}::uuid
      AND "usuario_id" = ${usuarioId}
      AND "estado" = 'pagado'
      AND "trabajo_id" IS NULL
    RETURNING "id"
  `;
  return filas.length > 0;
}

export async function moverReserva(desde, hasta) {
  await sql`
    UPDATE "pagos_visor" SET "trabajo_id" = ${hasta}
    WHERE "trabajo_id" = ${desde}
  `;
}

export async function liberarOrden(trabajoId) {
  await sql`
    UPDATE "pagos_visor" SET "trabajo_id" = NULL
    WHERE "trabajo_id" = ${trabajoId}
  `;
}

export async function crearPreferencia(orden, origen) {
  const token = tokenMercadoPago();
  if (!token) throw new Error('Falta MERCADOPAGO_ACCESS_TOKEN.');

  const cuerpo = {
    items: [
      {
        id: 'gemelo-digital-3d',
        title: 'Gemelo digital 3D',
        description: 'Reconstrucción 3D de un ambiente a partir de fotos o video.',
        quantity: 1,
        currency_id: String(orden.moneda || 'USD').toUpperCase(),
        unit_price: Number(orden.monto_moneda || orden.monto_usd),
      },
    ],
    external_reference: orden.id,
    notification_url: `${origen}/api/visor/pagos/webhook`,
    back_urls: {
      success: `${origen}/dashboard?pago=${orden.id}`,
      failure: `${origen}/dashboard?pago=${orden.id}`,
      pending: `${origen}/dashboard?pago=${orden.id}`,
    },
    auto_return: 'approved',
    statement_descriptor: 'SPATIALVALUE',
    metadata: { pago_id: orden.id, usuario_id: orden.usuario_id },
  };

  const respuesta = await fetch(`${MP_API}/checkout/preferences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': orden.id,
    },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(15_000),
  });

  const texto = await respuesta.text();
  let datos = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = null;
  }

  if (!respuesta.ok) {
    throw new Error(
      `MercadoPago ${respuesta.status}: ${String(datos?.message || texto || '').slice(0, 200)}`
    );
  }

  const initPoint = datos?.init_point || datos?.sandbox_init_point;
  if (!datos?.id || !initPoint) throw new Error('MercadoPago no devolvió el enlace de pago.');

  await guardarPreferencia(orden.id, String(datos.id), initPoint);
  return { id: String(datos.id), initPoint };
}

export async function consultarPago(pagoId) {
  const token = tokenMercadoPago();
  if (!token || !pagoId) return null;

  const respuesta = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(String(pagoId))}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!respuesta.ok) return null;
  return respuesta.json().catch(() => null);
}

export async function buscarPagoAprobado(ordenId) {
  const token = tokenMercadoPago();
  if (!token) return null;

  const params = new URLSearchParams({
    external_reference: String(ordenId),
    sort: 'date_created',
    criteria: 'desc',
    limit: '10',
  });

  const respuesta = await fetch(`${MP_API}/v1/payments/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!respuesta.ok) return null;

  const datos = await respuesta.json().catch(() => null);
  const resultados = Array.isArray(datos?.results) ? datos.results : [];
  return resultados.find((pago) => pago?.status === 'approved') || null;
}

export function pagoAprobado(pago, orden) {
  if (!pago || !orden) return false;
  if (String(pago.external_reference || '') !== String(orden.id)) return false;
  if (String(pago.status || '') !== 'approved') return false;

  const moneda = String(pago.currency_id || '').toUpperCase();
  const monedaOrden = String(orden.moneda || 'USD').toUpperCase();
  const monto = Number(pago.transaction_amount) || 0;
  const esperado = Number(orden.monto_moneda || orden.monto_usd);

  if (moneda !== monedaOrden) return false;
  if (moneda === 'USD') return monto + 0.01 >= esperado;
  if (moneda === 'ARS') return monto + 1 >= esperado;
  return false;
}

export function firmaWebhookValida(request, dataId) {
  const secreto = String(process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim();
  if (!secreto) return true;

  const firma = String(request.headers.get('x-signature') || '');
  const requestId = String(request.headers.get('x-request-id') || '');
  const partes = {};

  for (const trozo of firma.split(',')) {
    const [clave, valor] = trozo.split('=');
    if (clave && valor) partes[clave.trim()] = valor.trim();
  }

  if (!partes.ts || !partes.v1) return false;

  const manifiesto = `id:${dataId};request-id:${requestId};ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', secreto).update(manifiesto).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(partes.v1));
  } catch {
    return false;
  }
}
