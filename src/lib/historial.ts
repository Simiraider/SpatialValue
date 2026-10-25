/**
 * Serie histórica del valor USD/m² por barrio (12 meses).
 *
 * Hoy se genera de forma determinística a partir del valor de referencia del
 * barrio (misma semilla para el mismo nombre), para que el gráfico sea estable
 * entre renders. Queda preparado para reemplazarse por la serie real que
 * entregue el scraper o la fuente oficial, sin tocar los componentes.
 */

export type PuntoHistorial = { mes: string; valor: number; variacion: number };

function hashTexto(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function serieHistorialM2(barrio: string | undefined, valorM2: number, meses = 12): PuntoHistorial[] {
  let s = hashTexto(String(barrio || 'caba').trim().toLowerCase()) || 1;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const actual = Math.max(1, Math.round(valorM2) || 1);
  const valores = new Array<number>(meses).fill(actual);
  for (let i = meses - 2; i >= 0; i--) {
    const variacion = (rnd() - 0.4) * 0.04;
    valores[i] = Math.max(1, Math.round(valores[i + 1] / (1 + variacion)));
  }
  const hoy = new Date();
  const puntos: PuntoHistorial[] = [];
  for (let i = 0; i < meses; i++) {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - (meses - 1 - i), 1);
    const mes = fecha.toLocaleDateString('es-AR', { month: 'short' }).replace('.', '');
    const valor = valores[i];
    const anterior = i > 0 ? valores[i - 1] : valor;
    puntos.push({
      mes,
      valor,
      variacion: anterior > 0 ? ((valor - anterior) / anterior) * 100 : 0,
    });
  }
  return puntos;
}

/** Variación acumulada del rango, en porcentaje (ej. 7.4 = +7.4%). */
export function variacionRango(puntos: PuntoHistorial[]): number {
  if (puntos.length < 2) return 0;
  const primero = puntos[0].valor || 1;
  const ultimo = puntos[puntos.length - 1].valor || primero;
  return ((ultimo - primero) / primero) * 100;
}
