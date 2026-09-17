// Geocodificación y validación de direcciones.
// Proveedor primario: Google Maps Geocoding API (si hay GOOGLE_MAPS_API_KEY / VITE_GOOGLE_MAPS_API_KEY).
// Fallback: Nominatim (OpenStreetMap), como se venía usando.

export interface ResultadoGeocoding {
  existe: boolean;
  lat: number | null;
  lng: number | null;
  direccionFormateada: string | null;
  barrioDetectado: string | null;
  ciudadDetectada: string | null;
  barrioCoincide: boolean;
  fuente: 'google' | 'nominatim' | 'ninguna';
}

const BARRIOS_CABA: Record<string, string> = {
  agronomia: 'Agronomía', almagro: 'Almagro', balvanera: 'Balvanera', barracas: 'Barracas',
  belgrano: 'Belgrano', boedo: 'Boedo', caballito: 'Caballito', chacarita: 'Chacarita',
  coghlan: 'Coghlan', colegiales: 'Colegiales', constitucion: 'Constitución', flores: 'Flores',
  floresta: 'Floresta', 'la boca': 'La Boca', 'la paternal': 'La Paternal', 'la paternal (paternal)': 'La Paternal',
  paternal: 'La Paternal', liniers: 'Liniers', mataderos: 'Mataderos', monserrat: 'Monserrat',
  montserrat: 'Monserrat', 'monte castro': 'Monte Castro', 'nueva pompeya': 'Nueva Pompeya',
  nunez: 'Núñez', palermo: 'Palermo', 'parque avellaneda': 'Parque Avellaneda',
  'parque chacabuco': 'Parque Chacabuco', 'parque chas': 'Parque Chas',
  'parque patricios': 'Parque Patricios', 'puerto madero': 'Puerto Madero',
  recoleta: 'Recoleta', retiro: 'Retiro', saavedra: 'Saavedra', 'san cristobal': 'San Cristóbal',
  'san nicolas': 'San Nicolás', 'san telmo': 'San Telmo', 'velez sarsfield': 'Vélez Sarsfield',
  versalles: 'Versalles', 'villa crespo': 'Villa Crespo', 'villa del parque': 'Villa del Parque',
  'villa devoto': 'Villa Devoto', 'villa general mitre': 'Villa General Mitre',
  'villa lugano': 'Villa Lugano', 'villa luro': 'Villa Luro', 'villa ortuzar': 'Villa Ortúzar',
  'villa pueyrredon': 'Villa Pueyrredón', 'villa real': 'Villa Real',
  'villa riachuelo': 'Villa Riachuelo', 'villa santa rita': 'Villa Santa Rita',
  'villa soldati': 'Villa Soldati', 'villa urquiza': 'Villa Urquiza',
};

function normalizar(texto: string | null | undefined): string {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bbarrio\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normaliza el nombre de un barrio detectado contra el listado oficial de CABA. */
export function canonizarBarrio(nombre: string | null | undefined): string | null {
  const clave = normalizar(nombre);
  if (!clave) return null;
  if (BARRIOS_CABA[clave]) return BARRIOS_CABA[clave];
  const parcial = Object.keys(BARRIOS_CABA).find((k) => clave.includes(k) || k.includes(clave));
  return parcial ? BARRIOS_CABA[parcial] : null;
}

/** true si dos nombres de barrio refieren al mismo barrio de CABA (tolera acentos/formato). */
export function barriosCoinciden(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = canonizarBarrio(a);
  const nb = canonizarBarrio(b);
  if (!na || !nb) return false;
  return normalizar(na) === normalizar(nb);
}

function getEnvKey(): string {
  // Astro/Vite expone variables de entorno de servidor y de build (públicas con prefijo VITE_).
  const env: any =
    typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env : {};
  // En el servidor también puede estar como variable de entorno de Node (runtime Vercel).
  const nodeEnv = (globalThis as any)?.process?.env;
  const deProcess = nodeEnv?.GOOGLE_MAPS_API_KEY || '';
  return String(env.GOOGLE_MAPS_API_KEY || env.VITE_GOOGLE_MAPS_API_KEY || deProcess || '').trim();
}

interface ComponenteGoogle {
  long_name: string;
  types: string[];
}

function extraerComponentes(componentes: ComponenteGoogle[]) {
  let barrio: string | null = null;
  let ciudad: string | null = null;
  for (const c of componentes) {
    const t = c.types;
    if (!barrio && (t.includes('sublocality_level_1') || t.includes('sublocality') || t.includes('neighborhood'))) {
      barrio = c.long_name;
    }
    if (!ciudad && (t.includes('locality') || t.includes('administrative_area_level_2'))) {
      ciudad = c.long_name;
    }
  }
  return { barrio, ciudad };
}

async function geocodificarGoogle(query: string, apiKey: string): Promise<ResultadoGeocoding | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=ar&key=${apiKey}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    if (data.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) {
      // ZERO_RESULTS = la dirección no existe; REQUEST_DENIED / OVER_QUERY_LIMIT = sin key válida → probar fallback
      if (data.status === 'ZERO_RESULTS') return null;
      console.warn('Google Geocoding status:', data.status, data.error_message || '');
      return null;
    }
    const r = data.results[0];
    const { barrio, ciudad } = extraerComponentes(r.address_components || []);
    return {
      existe: true,
      lat: r.geometry?.location?.lat ?? null,
      lng: r.geometry?.location?.lng ?? null,
      direccionFormateada: r.formatted_address ?? null,
      barrioDetectado: barrio,
      ciudadDetectada: ciudad,
      barrioCoincide: false, // se calcula afuera, comparando con el barrio declarado
      fuente: 'google',
    };
  } catch (e: any) {
    console.warn('Google Geocoding falló:', e?.message || e);
    return null;
  }
}

async function geocodificarNominatim(query: string): Promise<ResultadoGeocoding | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(query)}&limit=1&countrycodes=ar`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SpatialValue/1.0 (tasaciones)' },
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const r = data[0];
    const direccion = r.address || {};
    return {
      existe: true,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      direccionFormateada: r.display_name ?? null,
      barrioDetectado: direccion.suburb || direccion.neighbourhood || direccion.city_district || null,
      ciudadDetectada: direccion.city || direccion.town || direccion.village || null,
      barrioCoincide: false,
      fuente: 'nominatim',
    };
  } catch (e: any) {
    console.warn('Nominatim falló:', e?.message || e);
    return null;
  }
}

/**
 * Verifica que la dirección exista y, si es posible, que el barrio declarado coincida
 * con el que detecta el proveedor de geocodificación.
 */
export async function verificarDireccion(
  direccion: string,
  barrio?: string | null,
  ciudad: string = 'Ciudad de Buenos Aires'
): Promise<ResultadoGeocoding> {
  const direccionLimpia = String(direccion || '').trim();
  if (!direccionLimpia) {
    return { existe: false, lat: null, lng: null, direccionFormateada: null, barrioDetectado: null, ciudadDetectada: null, barrioCoincide: false, fuente: 'ninguna' };
  }

  const query = `${direccionLimpia}, ${barrio ? `${barrio}, ` : ''}${ciudad}, Argentina`;
  const apiKey = getEnvKey();

  let resultado: ResultadoGeocoding | null = null;
  if (apiKey) {
    resultado = await geocodificarGoogle(query, apiKey);
  }
  if (!resultado) {
    resultado = await geocodificarNominatim(query);
  }

  if (!resultado) {
    return { existe: false, lat: null, lng: null, direccionFormateada: null, barrioDetectado: null, ciudadDetectada: null, barrioCoincide: false, fuente: apiKey ? 'google' : 'nominatim' };
  }

  resultado.barrioCoincide = barriosCoinciden(barrio, resultado.barrioDetectado);
  return resultado;
}
