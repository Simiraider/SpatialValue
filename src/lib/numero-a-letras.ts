const UNIDADES = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete',
  'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés',
  'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
];

const DECENAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = ['', 'cien', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

/** Convierte 0..999 a palabras. */
function centenas(n: number): string {
  if (n < 30) return UNIDADES[n];
  if (n < 100) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    if (u === 0) return DECENAS[d];
    return d === 2 ? `veinti${UNIDADES[u]}` : `${DECENAS[d]} y ${UNIDADES[u]}`;
  }
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c === 1 && resto === 0) return 'cien';
  const cent = c === 1 ? 'ciento' : CENTENAS[c];
  if (resto === 0) return cent;
  return `${cent} ${centenas(resto)}`;
}

/** Convierte 0..999.999 a palabras. */
function miles(n: number): string {
  if (n < 1000) return centenas(n);
  const m = Math.floor(n / 1000);
  const resto = n % 1000;
  const mStr = m === 1 ? 'mil' : `${centenas(m).replace(/uno$/, 'ún')} mil`;
  if (resto === 0) return mStr;
  return `${mStr} ${centenas(resto)}`;
}

/**
 * Convierte un número entero a su expresión en letras en español.
 * Ej: 200000 -> "doscientos mil"
 */
export function numeroALetras(n: number): string {
  const entero = Math.floor(Math.abs(n));
  const prefijo = n < 0 ? 'menos ' : '';
  if (entero < 1000000) return prefijo + miles(entero);
  const millones = Math.floor(entero / 1000000);
  const resto = entero % 1000000;
  const mStr = millones === 1 ? 'un millón' : `${miles(millones)} millones`;
  if (resto === 0) return prefijo + mStr;
  return prefijo + `${mStr} ${miles(resto)}`;
}

/** Monto monetario en letras: "doscientos mil dólares estadounidenses" o "dos millones de pesos argentinos". */
export function montoEnLetras(valor: number, moneda: 'USD' | 'ARS'): string {
  const entero = Math.floor(Math.abs(valor));
  const singular = moneda === 'USD' ? 'un dólar estadounidense' : 'un peso argentino';
  if (entero === 1) return singular;
  const base = entero === 0 ? 'cero' : numeroALetras(entero).replace(/\buno\b/, 'un');
  const plural = moneda === 'USD' ? 'dólares estadounidenses' : 'pesos argentinos';
  return `${base} ${plural}`;
}

/** Valor en dólares: "doscientos mil dólares estadounidenses". */
export function valorEnLetras(valor: number): string {
  return montoEnLetras(valor, 'USD');
}
