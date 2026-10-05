import {
  TASA_ARS_USD,
  RENTABILIDAD_ANUAL_ALQUILER,
  estimarAlquiler,
  estimarPrecioVenta,
  valorM2Alquiler,
  valorM2Venta,
} from './mercado';

export type DatosTasacion = Record<string, any>;

const MARGEN_RANGO = 0.07;

export function esAlquiler(data: DatosTasacion): boolean {
  return data.tipoTasacion === 'alquiler' || data.tipo_operacion === 'alquiler';
}

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
  rangoMin: number;
  rangoMax: number;
}

/**
 * Rango ±7% redondeado. Antes se redondeaba siempre a miles, lo que en
 * alquileres (ej. USD 450/mes) daba rangos absurdos como 0 – 1000.
 */
function calcularRango(valorUsd: number, alquiler: boolean): { rangoMin: number; rangoMax: number } {
  const paso = alquiler ? 10 : 1000;
  const redondear = (n: number) => Math.round(n / paso) * paso;
  return {
    rangoMin: redondear(valorUsd * (1 - MARGEN_RANGO)),
    rangoMax: redondear(valorUsd * (1 + MARGEN_RANGO)),
  };
}

export function calcularValores(data: DatosTasacion, tasaArs: number = TASA_ARS_USD): ValoresCalculados {
  const alquiler = esAlquiler(data);
  const precioIA = Number(data.precioEstimadoUsd) || 0; // evita NaN
  const supCub = Number(data.superficieCubierta) || 0;
  const supDesc = Number(data.superficieDescubierta) || 0;
  const supTotal = supCub + supDesc;
  const barrio = data.barrio || data.ciudad;
  const expensasDeclaradas = Number(data.expensas) || 0;
  const expensas = expensasDeclaradas > 0 ? expensasDeclaradas : estimarExpensas(data.comodidades);

  const base = { supCub, supDesc, supTotal, expensas, expensasDeclaradas };

  if (alquiler) {
    const valorUsd =
      precioIA > 0
        ? Math.round((precioIA * RENTABILIDAD_ANUAL_ALQUILER) / 12)
        : estimarAlquiler(supCub, supDesc, barrio);
    return {
      ...base,
      precioIA: valorUsd,
      esIA: precioIA > 0,
      valorUsd,
      valorArs: Math.round(valorUsd * tasaArs),
      valorM2: valorM2Alquiler(barrio),
      ...calcularRango(valorUsd, true),
    };
  }

  if (precioIA > 0) {
    const valorUsd = Math.round(precioIA);
    return {
      ...base,
      precioIA,
      esIA: true,
      valorUsd,
      valorArs: Math.round(valorUsd * tasaArs),
      valorM2: supCub > 0 ? Math.round(valorUsd / supCub) : valorM2Venta(barrio),
      ...calcularRango(valorUsd, false),
    };
  }

  const valorUsd = estimarPrecioVenta(supCub, supDesc, barrio);
  return {
    ...base,
    precioIA,
    esIA: false,
    valorUsd,
    valorArs: Math.round(valorUsd * tasaArs),
    valorM2: valorM2Venta(barrio),
    ...calcularRango(valorUsd, false),
  };
}

export function esBorrador(data: DatosTasacion): boolean {
  return data.es_borrador === true || data.estado_tasacion === 'borrador';
}

export function estadoConservacion(n: number, overrides: { antiguedad?: unknown } = {}): string {
  const antiguedad = Number(overrides.antiguedad);
  if (Number.isFinite(antiguedad) && antiguedad > 0) {
    if (antiguedad <= 5) return n >= 7 ? 'Muy bueno' : n >= 4 ? 'Bueno' : 'A refaccionar';
    // Más de 5 años (el tramo 5–15 y el de >15 daban el mismo resultado)
    return n >= 7 ? 'Bueno' : n >= 4 ? 'Regular' : 'A refaccionar';
  }
  if (n >= 9) return 'Muy bueno';
  if (n >= 7) return 'Bueno';
  if (n >= 4) return 'Regular';
  return 'A refaccionar';
}

export function estadoDesdeDatos(data: DatosTasacion): string {
  const n = Number(data.estadoGeneral) || 5;
  const esEstreno = Number(data.antiguedad) === 0 && String(data.antiguedad ?? '').trim() !== '';
  if (esEstreno && n >= 8) return 'A estrenar';
  return estadoConservacion(n, { antiguedad: data.antiguedad });
}

export function antiguedadEstimada(n: number, overrides: { antiguedad?: unknown } = {}): string {
  const antiguedad = Number(overrides.antiguedad);
  if (Number.isFinite(antiguedad) && antiguedad >= 0 && String(overrides.antiguedad ?? '').trim() !== '') {
    const a = Math.round(antiguedad);
    if (a === 0) return 'A estrenar';
    return `${a} año${a === 1 ? '' : 's'}`;
  }
  if (n >= 9) return 'Menos de 5 años (est.)';
  if (n >= 7) return 'Entre 5 y 15 años (est.)';
  if (n >= 4) return 'Entre 15 y 30 años (est.)';
  return 'Más de 30 años (est.)';
}

export function antiguedadDesdeDatos(data: DatosTasacion): string {
  return antiguedadEstimada(Number(data.estadoGeneral) || 5, { antiguedad: data.antiguedad });
}