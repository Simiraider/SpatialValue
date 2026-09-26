import crypto from 'node:crypto';

const ENV = {
  ...(typeof process !== 'undefined' && process.env ? process.env : {}),
  ...(import.meta.env || {}),
};

const esDev = ENV.DEV ?? true;

const SECRETO_SESION =
  ENV.SESSION_SECRET ||
  ENV.CONFIG_DATABASE_URL ||
  'spatial-value-secreto-solo-desarrollo';

if (!ENV.SESSION_SECRET) {
  console.warn(
    '[sesion] SESSION_SECRET no está definida: se usa una clave derivada. Definila en producción.'
  );
}

const FIRMA_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firmar(valor) {
  return crypto.createHmac('sha256', SECRETO_SESION).update(valor).digest('base64url');
}

export function verificarFirma(valor, mac) {
  if (!valor || !mac || !FIRMA_RE.test(mac)) return false;
  const esperada = firmar(valor);
  const a = Buffer.from(mac);
  const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function cookieSesion(usuarioId) {
  return `usuario_id=${usuarioId}.${firmar(usuarioId)}; Path=/; Max-Age=604800; SameSite=Lax; Secure`;
}

function leerCookie(request, nombre) {
  const cookies = request.headers.get('cookie') || '';
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${nombre}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function resolverUsuarioId(request) {
  const valor = leerCookie(request, 'usuario_id');
  if (!valor) return null;

  const punto = valor.lastIndexOf('.');
  if (punto <= 0) {
    if (esDev && valor === 'demo-user') return 'demo-user';
    return null;
  }
  const id = valor.slice(0, punto);
  const mac = valor.slice(punto + 1);
  if (!verificarFirma(id, mac)) return null;
  return UUID_RE.test(id) ? id : null;
}

export function idFirmado(usuarioId) {
  return `${usuarioId}.${firmar(usuarioId)}`;
}

const ventana = new Map();

export function permitirFrecuencia(clave, maximo, ventanaMs = 300_000) {
  const ahora = Date.now();
  const registro = ventana.get(clave);

  if (!registro || ahora > registro.expira) {
    ventana.set(clave, { cuenta: 1, expira: ahora + ventanaMs });
    return true;
  }
  registro.cuenta += 1;
  if (registro.cuenta > maximo) return false;
  return true;
}

setInterval(() => {
  const ahora = Date.now();
  for (const [clave, registro] of ventana) {
    if (ahora > registro.expira) ventana.delete(clave);
  }
}, 600_000).unref?.();

export function ipDePeticion(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'desconocida'
  );
}
