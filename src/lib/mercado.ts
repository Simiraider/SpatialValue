export const TASA_ARS_USD = 1500;

export const VALOR_M2_VENTA_DEFAULT = 2400;

const RENTABILIDAD_ANUAL_ALQUILER = 0.045;

const VENTA_M2_POR_BARRIO: Record<string, number> = {
  'puerto madero': 5500,
  recoleta: 3200,
  palermo: 3000,
  belgrano: 2600,
  nunez: 2400,
  colegiales: 2300,
  caballito: 2200,
  'villa crespo': 2200,
  chacarita: 2200,
  'san telmo': 2200,
  almagro: 2100,
  boedo: 1900,
  saavedra: 1900,
  'villa devoto': 1800,
  agronomia: 1800,
  'villa del parque': 1700,
  barracas: 1700,
  paternal: 1700,
  flores: 1600,
  'parque patricios': 1600,
  versalles: 1500,
  liniers: 1400,
};

function normalizarBarrio(barrio?: string | null): string {
  return String(barrio || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function valorM2Venta(barrio?: string | null): number {
  const clave = normalizarBarrio(barrio);
  return (clave && VENTA_M2_POR_BARRIO[clave]) || VALOR_M2_VENTA_DEFAULT;
}

export function valorM2Alquiler(barrio?: string | null): number {
  return Math.max(1, Math.round((valorM2Venta(barrio) * RENTABILIDAD_ANUAL_ALQUILER) / 12));
}

export function estimarPrecioVenta(supCub: number, supDesc: number, barrio?: string | null): number {
  const m2Venta = valorM2Venta(barrio);
  return Math.round(supCub * m2Venta + Math.max(supDesc, 0) * m2Venta * 0.4);
}
