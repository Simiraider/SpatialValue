export type TipoTasacion = 'venta' | 'alquiler';

export type DatosTasacion = Record<string, any>;

export function esAlquiler(data: DatosTasacion): boolean {
  // El draft usa tipoTasacion; el backend/DB usa tipo_operacion.
  return data.tipoTasacion === 'alquiler' || data.tipo_operacion === 'alquiler';
}

/** Estima las expensas mensuales (ARS) a partir de los amenities declarados. */
export function estimarExpensas(comodidades?: string[]): number {
  if (!Array.isArray(comodidades)) return 120000;
  const extras: [string, number][] = [
    ['Cochera', 45000],
    ['Pileta', 30000],
    ['SUM', 25000],
    ['Parrilla', 15000],
    ['Gimnasio', 25000],
    ['Seguridad 24h', 35000],
    ['Balcón', 5000],
    ['Patio', 5000],
  ];
  return extras.reduce((acc, [amenity, valor]) => (comodidades.includes(amenity) ? acc + valor : acc), 120000);
}

export interface ValoresCalculados {
  precioIA: number;
  supCub: number;
  supDesc: number;
  supTotal: number;
  esIA: boolean;
  valorUsd: number;
  valorArs: number;
  valorM2: number;
  expensas: number;
  expensasDeclaradas: number;
}

/**
 * Calcula los valores del informe a partir de los datos de la tasación.
 * El valor en USD proviene del modelo de IA (precioEstimadoUsd) o de un fallback local.
 */
export function calcularValores(data: DatosTasacion): ValoresCalculados {
  const precioIA = Number(data.precioEstimadoUsd);
  const supCub = Number(data.superficieCubierta) || 0;
  const supDesc = Number(data.superficieDescubierta) || 0;
  const supTotal = supCub + supDesc;
  const esIA = precioIA > 0;
  const valorUsd = esIA ? precioIA : supCub * 2500 || 0;
  const valorArs = Math.round(valorUsd * 1000);
  const valorM2 = supCub > 0 ? Math.round(valorUsd / supCub) : 2500;
  const expensasDeclaradas = Number(data.expensas) || 0;
  const expensas = expensasDeclaradas > 0 ? expensasDeclaradas : estimarExpensas(data.comodidades);
  return { precioIA, supCub, supDesc, supTotal, esIA, valorUsd, valorArs, valorM2, expensas, expensasDeclaradas };
}

export function estadoConservacion(n: number): string {
  if (n >= 9) return 'Muy bueno — A estrenar';
  if (n >= 7) return 'Bueno';
  if (n >= 4) return 'Regular';
  return 'A refaccionar';
}

export function antiguedadEstimada(n: number): string {
  if (n >= 9) return 'Menos de 5 años (est.)';
  if (n >= 7) return 'Entre 5 y 15 años (est.)';
  if (n >= 4) return 'Entre 15 y 30 años (est.)';
  return 'Más de 30 años (est.)';
}
