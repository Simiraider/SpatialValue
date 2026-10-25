export const prerender = false;
import { SERIE_VENTA, PERIODO_ACTUAL, SERIE_ETIQUETA, SERIE_FUENTE } from '../../data/historico-barrios';
import { FACTOR_ALQUILER, serieDeAlquiler, valoresBarrio, resumenSerie } from '../../lib/historico';
import { VALORES_M2_POR_BARRIO } from '../../lib/mercado';

export async function GET({ request }) {
  const url = new URL(request.url);
  const barrioQuery = url.searchParams.get('barrio')?.toLowerCase()?.trim();
  const criterio = url.searchParams.get('criterio') === 'alquiler' ? 'alquiler' : 'venta';

  const cabeceras = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600',
    'Access-Control-Allow-Origin': '*',
  };

  if (barrioQuery && barrioQuery !== 'todos') {
    const clave = barrioQuery
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const serieVenta = SERIE_VENTA[clave];
    if (!serieVenta) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Barrio '${barrioQuery}' no encontrado en la serie oficial.`,
          barriosDisponibles: Object.keys(SERIE_VENTA),
        }),
        { status: 404, headers: cabeceras }
      );
    }

    const serieFinal = criterio === 'alquiler' ? serieDeAlquiler(serieVenta) : serieVenta;
    const ref = VALORES_M2_POR_BARRIO[clave];
    const { venta, alquiler, variacion, vigente } = valoresBarrio(clave, {
      venta: ref?.venta ?? null,
      alquiler: ref?.alquiler ?? null,
    });

    const resumen = resumenSerie(serieFinal);

    return new Response(
      JSON.stringify({
        ok: true,
        barrio: clave,
        criterio,
        vigente,
        valorActual: criterio === 'venta' ? venta : alquiler,
        variacion12m: variacion,
        resumen,
        fuente: SERIE_FUENTE,
        etiqueta: SERIE_ETIQUETA,
        periodoActual: PERIODO_ACTUAL,
        serie: serieFinal,
      }),
      { status: 200, headers: cabeceras }
    );
  }

  const resumenBarrios = {};
  for (const [k, serie] of Object.entries(SERIE_VENTA)) {
    const ref = VALORES_M2_POR_BARRIO[k];
    const { venta, alquiler, variacion } = valoresBarrio(k, {
      venta: ref?.venta ?? null,
      alquiler: ref?.alquiler ?? null,
    });
    resumenBarrios[k] = {
      venta,
      alquiler,
      variacion12m: variacion,
      totalPuntos: serie.length,
      primerPeriodo: serie[0]?.p,
      ultimoPeriodo: serie[serie.length - 1]?.p,
    };
  }

  return new Response(
    JSON.stringify({
      ok: true,
      fuente: SERIE_FUENTE,
      etiqueta: SERIE_ETIQUETA,
      periodoActual: PERIODO_ACTUAL,
      factorAlquiler: FACTOR_ALQUILER,
      totalBarrios: Object.keys(SERIE_VENTA).length,
      barrios: resumenBarrios,
    }),
    { status: 200, headers: cabeceras }
  );
}
