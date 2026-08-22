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
  'villa lugano': 1300,
  'villa soldati': 1250,
  'villa riachuelo': 1250,
  mataderos: 1450,
  'parque avellaneda': 1450,
  velez: 1600,
  montecastro: 1650,
  'floresta': 1550,
  'villa real': 1650,
  'villa luro': 1550,
  'villa santa rita': 1700,
  'villa general mitre': 1750,
  'la paternal': 1700,
  'villa ortuzar': 2250,
  'parque chas': 1900,
  'villa urquiza': 2300,
  coghlan: 2250,
  'villa pueyrredon': 1900,
  'parque chacabuco': 1700,
  'nueva pompeya': 1300,
  constitucion: 1500,
  monserrat: 1800,
  'la boca': 1450,
  'san nicolas': 2300,
  retiro: 2400,
  'san cristobal': 1700,
  'velez sarsfield': 1600,
};

/** Todos los barrios de CABA disponibles en el selector de tasación. */
export const BARRIOS_CABA = [
  'Agronomía', 'Almagro', 'Balvanera', 'Barracas', 'Belgrano', 'Boedo', 'Caballito',
  'Chacarita', 'Coghlan', 'Colegiales', 'Constitución', 'Flores', 'Floresta', 'La Boca',
  'La Paternal', 'Liniers', 'Mataderos', 'Monserrat', 'Monte Castro', 'Nueva Pompeya',
  'Núñez', 'Palermo', 'Parque Avellaneda', 'Parque Chacabuco', 'Parque Chas',
  'Parque Patricios', 'Puerto Madero', 'Recoleta', 'Retiro', 'Saavedra', 'San Cristóbal',
  'San Nicolás', 'San Telmo', 'Vélez Sarsfield', 'Versalles', 'Villa Crespo',
  'Villa del Parque', 'Villa Devoto', 'Villa General Mitre', 'Villa Lugano', 'Villa Luro',
  'Villa Ortúzar', 'Villa Pueyrredón', 'Villa Real', 'Villa Riachuelo', 'Villa Santa Rita',
  'Villa Soldati', 'Villa Urquiza',
];

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
