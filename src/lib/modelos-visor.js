import { readdirSync } from 'node:fs';

export function leerModelosVisor(directorio = 'public/modelos') {
  try {
    return readdirSync(directorio)
      .filter((archivo) => archivo.toLowerCase().endsWith('.glb'))
      .sort()
      .map((archivo) => ({
        nombre: archivo.replace(/\.glb$/i, '').replace(/[-_]+/g, ' '),
        ruta: `/modelos/${archivo}`,
      }));
  } catch {
    return [];
  }
}
