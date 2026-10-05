export const RUTAS_INTERNAS_SEGURAS = [
  '/',
  '/dashboard',
  '/tasacion',
  '/reporte',
  '/login',
  '/registro',
  '/cargando',
] as const;

export function rutaInternaSegura(destino: string | null | undefined, fallback = '/'): string {
  if (!destino || typeof destino !== 'string') return fallback;
  const limpio = destino.trim();
  if (!limpio.startsWith('/') || limpio.startsWith('//') || limpio.startsWith('/\\')) return fallback;
  if (/[\r\n\t"'<>\\]/.test(limpio)) return fallback;
  const ruta = limpio.split('?')[0].split('#')[0];
  return (RUTAS_INTERNAS_SEGURAS as readonly string[]).includes(ruta) ? limpio : fallback;
}

const ID_SEGURO_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function esIdSeguro(id: unknown): id is string {
  return typeof id === 'string' && ID_SEGURO_RE.test(id);
}

export function navegarA(
  ruta: string,
  query?: Record<string, string | number | undefined | null>,
  fallback = '/'
): void {
  const destino = rutaInternaSegura(ruta, fallback).split('?')[0].split('#')[0];
  if (query) {
    const params = new URLSearchParams();
    for (const [clave, valor] of Object.entries(query)) {
      if (valor !== undefined && valor !== null && valor !== '') params.set(clave, String(valor));
    }
    const qs = params.toString();
    window.location.href = qs ? `${destino}?${qs}` : destino;
    return;
  }
  window.location.href = destino;
}
