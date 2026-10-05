import { TASA_ARS_USD, estimarPrecioVenta, valorM2Alquiler, valorM2Venta } from './mercado';

export type DatosTasacion = Record<string, any>;

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

export function calcularValores(data: DatosTasacion, tasaArs: number = TASA_ARS_USD): ValoresCalculados {
  const alquiler = esAlquiler(data);
  const precioIA = Number(data.precioEstimadoUsd);
  const supCub = Number(data.superficieCubierta) || 0;
  const supDesc = Number(data.superficieDescubierta) || 0;
  const supTotal = supCub + supDesc;
  const barrio = data.barrio || data.ciudad;
  const expensasDeclaradas = Number(data.expensas) || 0;
  const expensas = expensasDeclaradas > 0 ? expensasDeclaradas : estimarExpensas(data.comodidades);

  if (alquiler) {
    const valorUsd = precioIA > 0 ? Math.round(precioIA * 0.045 / 12) : Math.round(supCub * valorM2Alquiler(barrio));
    const valorArs = Math.round(valorUsd * tasaArs);
    return {
      precioIA: valorUsd,
      supCub,
      supDesc,
      supTotal,
      esIA: precioIA > 0,
      valorUsd,
      valorArs,
      valorM2: valorM2Alquiler(barrio),
      expensas,
      expensasDeclaradas,
      rangoMin: Math.round(valorUsd * 0.93 / 1000) * 1000,
      rangoMax: Math.round(valorUsd * 1.07 / 1000) * 1000,
    };
  }

  const m2Venta = valorM2Venta(barrio);
  if (precioIA > 0) {
    const valorUsd = Math.round(precioIA);
    const valorArs = Math.round(valorUsd * tasaArs);
    const valorM2Calculado = supCub > 0 ? Math.round(valorUsd / supCub) : m2Venta;
    return {
      precioIA,
      supCub,
      supDesc,
      supTotal,
      esIA: true,
      valorUsd,
      valorArs,
      valorM2: valorM2Calculado,
      expensas,
      expensasDeclaradas,
      rangoMin: Math.round(valorUsd * 0.93 / 1000) * 1000,
      rangoMax: Math.round(valorUsd * 1.07 / 1000) * 1000,
    };
  }
  const valorUsd = estimarPrecioVenta(supCub, supDesc, barrio);
  const valorArs = Math.round(valorUsd * tasaArs);
  return {
    precioIA,
    supCub,
    supDesc,
    supTotal,
    esIA: false,
    valorUsd,
    valorArs,
    valorM2: m2Venta,
    expensas,
    expensasDeclaradas,
    rangoMin: Math.round(valorUsd * 0.93 / 1000) * 1000,
    rangoMax: Math.round(valorUsd * 1.07 / 1000) * 1000,
  };
}

export function esBorrador(data: DatosTasacion): boolean {
  return data.es_borrador === true || data.estado_tasacion === 'borrador';
}

export function estadoConservacion(n: number, overrides: { antiguedad?: unknown } = {}): string {
  const antiguedad = Number((overrides as any).antiguedad);
  if (Number.isFinite(antiguedad) && antiguedad > 0) {
    if (antiguedad <= 5) return n >= 7 ? 'Muy bueno' : n >= 4 ? 'Bueno' : 'A refaccionar';
    if (antiguedad <= 15) return n >= 7 ? 'Bueno' : n >= 4 ? 'Regular' : 'A refaccionar';
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
  const antiguedad = Number((overrides as any).antiguedad);
  if (Number.isFinite(antiguedad) && antiguedad >= 0 && String((overrides as any).antiguedad ?? '').trim() !== '') {
    const a = Math.round(antiguedad);
    if (a === 0) return 'A estrenar';
    if (a <= 5) return `${a} año${a === 1 ? '' : 's'}`;
    return `${a} años`;
  }
  if (n >= 9) return 'Menos de 5 años (est.)';
  if (n >= 7) return 'Entre 5 y 15 años (est.)';
  if (n >= 4) return 'Entre 15 y 30 años (est.)';
  return 'Más de 30 años (est.)';
}

export function antiguedadDesdeDatos(data: DatosTasacion): string {
  return antiguedadEstimada(Number(data.estadoGeneral) || 5, { antiguedad: data.antiguedad });
}
