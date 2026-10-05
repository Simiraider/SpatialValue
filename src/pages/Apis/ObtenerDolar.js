export const prerender = false;
import { resolverUsuarioId, permitirFrecuencia, ipDePeticion } from '../../Backend/sesion.js';
import { TASA_ARS_USD } from '../../lib/mercado';

const CACHE_MS = 30 * 60 * 1000;
const BANDA_MIN = 100;
const BANDA_MAX = 10000;

let cache = { valor: null, fuente: null, actualizado: null, expira: 0 };

async function traer(url, extraer) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const valor = extraer(await res.json());
    if (Number.isFinite(valor) && valor >= BANDA_MIN && valor <= BANDA_MAX) return valor;
    return null;
  } catch {
    return null;
  }
}

export async function GET({ request }) {
  if (!resolverUsuarioId(request)) {
    return new Response(
      JSON.stringify({ error: 'Sesión no válida' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!permitirFrecuencia(`dolar:${ipDePeticion(request)}`, 60)) {
    return new Response(
      JSON.stringify({ error: 'Demasiadas consultas' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const ahora = Date.now();
  if (cache.valor != null && ahora < cache.expira) {
    return new Response(
      JSON.stringify({ success: true, valor: cache.valor, fuente: cache.fuente, actualizado: cache.actualizado, cacheado: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const oficial = await traer(
    'https://dolarapi.com/v1/dolares/oficial',
    (d) => Number(d?.venta)
  );
  if (oficial != null) {
    cache = { valor: oficial, fuente: 'dolarapi-oficial', actualizado: new Date().toISOString(), expira: ahora + CACHE_MS };
    return new Response(
      JSON.stringify({ success: true, valor: oficial, fuente: cache.fuente, actualizado: cache.actualizado }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const blue = await traer(
    'https://api.bluelytics.com.ar/v2/latest',
    (d) => Number(d?.blue?.value_avg)
  );
  if (blue != null) {
    cache = { valor: blue, fuente: 'bluelytics-blue', actualizado: new Date().toISOString(), expira: ahora + CACHE_MS };
    return new Response(
      JSON.stringify({ success: true, valor: blue, fuente: cache.fuente, actualizado: cache.actualizado }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ success: true, valor: TASA_ARS_USD, fuente: 'fallback', actualizado: cache.actualizado }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
