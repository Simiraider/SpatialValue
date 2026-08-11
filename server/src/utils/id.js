import { randomBytes } from 'node:crypto';

const ALFABETO = 'abcdefghijkmnpqrstuvwxyz23456789'; // sin l/o/0/1 para evitar confusiones

/** Id corto y legible: p.ej. "g3k7-x9p2-m4q8" */
export function generarId(longitud = 12) {
  const bytes = randomBytes(longitud);
  let out = '';
  for (let i = 0; i < longitud; i++) {
    out += ALFABETO[bytes[i] % ALFABETO.length];
    if ((i + 1) % 4 === 0 && i < longitud - 1) out += '-';
  }
  return out;
}

/** Hash numérico estable de un string (para seeds determinísticos). */
export function hashString(texto) {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
