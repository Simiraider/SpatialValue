import { PERIODO_ACTUAL, SERIE_VENTA, type PuntoSerie } from '../data/historico-barrios';

export const FACTOR_ALQUILER = 0.045 / 12;

const TRIMES = 4;

export function parsePeriodo(p: string): { anio: number; trim: number } {
  const [anio, trim] = p.split('-T');
  return { anio: Number(anio), trim: Number(trim) };
}

export function periodoAnterior(p: string, saltos = 1): string {
  const { anio, trim } = parsePeriodo(p);
  const total = anio * TRIMES + (trim - 1) - saltos;
  return `${Math.floor(total / TRIMES)}-T${(total % TRIMES) + 1}`;
}

export function ultimosPeriodos(hasta: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(periodoAnterior(hasta, i));
  return out;
}

export function ultimo(serie: PuntoSerie[]): PuntoSerie | null {
  return serie.length ? serie[serie.length - 1] : null;
}

export function esVigente(serie: PuntoSerie[]): boolean {
  const u = ultimo(serie);
  if (!u) return false;
  return periodoAnterior(PERIODO_ACTUAL, 1) <= u.p;
}

export function variacionDesde(serie: PuntoSerie[], atras = TRIMES): number | null {
  if (serie.length <= atras) return null;
  const fin = serie[serie.length - 1].v;
  const ini = serie[serie.length - 1 - atras].v;
  if (!ini) return null;
  return ((fin - ini) / ini) * 100;
}

export function serieReciente(serie: PuntoSerie[], n = 16): PuntoSerie[] {
  return serie.slice(Math.max(0, serie.length - n));
}

export type RangoTiempo = '4a' | '10a' | 'all';

export function seriePorRango(serie: PuntoSerie[], rango: RangoTiempo): PuntoSerie[] {
  if (rango === '4a') return serieReciente(serie, 16);
  if (rango === '10a') return serieReciente(serie, 40);
  return serie;
}

export function variacionesTrimestrales(
  serie: PuntoSerie[],
  n = 16
): { periodo: string; etiqueta: string; trimestreLargo: string; pct: number; valor: number; anterior: number }[] {
  const puntos = n ? serieReciente(serie, n + 1) : serie;
  const out: { periodo: string; etiqueta: string; trimestreLargo: string; pct: number; valor: number; anterior: number }[] = [];
  for (let i = 1; i < puntos.length; i++) {
    const ant = puntos[i - 1].v;
    if (!ant) continue;
    const { anio, trim } = parsePeriodo(puntos[i].p);
    const nombresTrim: Record<number, string> = {
      1: 'Ene-Mar',
      2: 'Abr-Jun',
      3: 'Jul-Sep',
      4: 'Oct-Dic',
    };
    out.push({
      periodo: puntos[i].p,
      etiqueta: `T${trim} '${String(anio).slice(2)}`,
      trimestreLargo: `T${trim} ${anio} (${nombresTrim[trim] ?? ''})`,
      pct: Math.round(((puntos[i].v - ant) / ant) * 1000) / 10,
      valor: puntos[i].v,
      anterior: ant,
    });
  }
  return out;
}

export function serieDeAlquiler(serie: PuntoSerie[]): PuntoSerie[] {
  return serie.map((p) => ({ p: p.p, v: Math.round(p.v * FACTOR_ALQUILER * 10) / 10 }));
}

export function resumenSerie(serie: PuntoSerie[]): {
  maximo: number;
  maximoPeriodo: string;
  minimo: number;
  minimoPeriodo: string;
  variacionTotal: number | null;
  primerAnio: number | null;
  ultimoAnio: number | null;
  totalPuntos: number;
} | null {
  if (!serie.length) return null;
  let maxP = serie[0];
  let minP = serie[0];
  for (const pt of serie) {
    if (pt.v > maxP.v) maxP = pt;
    if (pt.v < minP.v) minP = pt;
  }
  const primero = serie[0].v;
  const ultimoVal = serie[serie.length - 1].v;
  return {
    maximo: maxP.v,
    maximoPeriodo: maxP.p.replace('-T', ' T'),
    minimo: minP.v,
    minimoPeriodo: minP.p.replace('-T', ' T'),
    variacionTotal: primero ? Math.round(((ultimoVal - primero) / primero) * 1000) / 10 : null,
    primerAnio: parsePeriodo(serie[0].p).anio,
    ultimoAnio: parsePeriodo(serie[serie.length - 1].p).anio,
    totalPuntos: serie.length,
  };
}

export function valoresBarrio(
  clave: string,
  ref: { venta: number | null; alquiler: number | null }
): {
  serie: PuntoSerie[];
  vigente: boolean;
  venta: number | null;
  alquiler: number | null;
  variacion: number | null;
} {
  const serie = SERIE_VENTA[clave] ?? [];
  const vigente = esVigente(serie);
  const ultimoV = vigente ? serie[serie.length - 1].v : null;
  return {
    serie,
    vigente,
    venta: ultimoV != null ? Math.round(ultimoV) : ref.venta,
    alquiler: ultimoV != null ? Math.max(1, Math.round(ultimoV * FACTOR_ALQUILER)) : ref.alquiler,
    variacion: vigente ? variacionDesde(serie, TRIMES) : null,
  };
}

export function dominioAjustado(valores: number[]): [number, number] {
  if (!valores.length) return [0, 1];
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const diff = max - min;
  const pad = Math.max(diff * 0.18, max * 0.03, 10);
  return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
}

export function ticksPeriodoAnual(puntos: PuntoSerie[], maximo = 8): string[] {
  if (!puntos || puntos.length === 0) return [];
  const primerPuntoPorAnio: PuntoSerie[] = [];
  let ultimoAnio = -1;
  for (const pt of puntos) {
    const { anio } = parsePeriodo(pt.p);
    if (anio !== ultimoAnio) {
      primerPuntoPorAnio.push(pt);
      ultimoAnio = anio;
    }
  }
  if (primerPuntoPorAnio.length <= maximo) {
    return primerPuntoPorAnio.map((pt) => pt.p);
  }
  const paso = Math.ceil(primerPuntoPorAnio.length / maximo);
  const seleccionados = primerPuntoPorAnio.filter((_, i) => i % paso === 0 || i === primerPuntoPorAnio.length - 1);
  return seleccionados.map((pt) => pt.p);
}

export function etiquetasAnio(puntos: PuntoSerie[], maximo = 6): string[] {
  const anios = [...new Set(puntos.map((p) => String(parsePeriodo(p.p).anio)))];
  if (anios.length <= maximo) return anios;
  const paso = Math.ceil(anios.length / maximo);
  return anios.filter((_, i) => i % paso === 0 || i === anios.length - 1);
}
