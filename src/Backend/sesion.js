import crypto from 'node:crypto';

const ENV = typeof process !== 'undefined' && process.env ? process.env : {};

const ES_PRODUCCION = String(ENV.NODE_ENV || '').toLowerCase() === 'production';

const SECRETO_SESION = String(ENV.SESSION_SECRET || '').trim();

if (!SECRETO_SESION) {
  if (ES_PRODUCCION) {
    throw new Error(
      '[sesion] SESSION_SECRET es obligatoria en producción. ' +
        'Definila en el entorno (por ejemplo con `openssl rand -base64 48`) antes de desplegar.'
    );
  }
  console.warn(
    '[sesion] SESSION_SECRET no está definida: se usa una clave de desarrollo. Nunca despliegues así.'
  );
}

const CLAVE_FIRMA =
  SECRETO_SESION || 'spatial-value-secreto-solo-desarrollo-no-usar-en-produccion';

const FIRMA_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_EDAD_SESION_SEG = 60 * 60 * 24 * 7;

function firmar(valor) {
  return crypto.createHmac('sha256', CLAVE_FIRMA).update(valor).digest('base64url');
}

export function igualSeguro(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verificarFirma(valor, mac) {
  if (!valor || !mac || !FIRMA_RE.test(mac)) return false;
  return igualSeguro(mac, firmar(valor));
}
export function cookieSesion(usuarioId) {
  return [
    `usuario_id=${encodeURIComponent(usuarioId)}.${firmar(usuarioId)}`,
    'Path=/',
    `Max-Age=${MAX_EDAD_SESION_SEG}`,
    'SameSite=Lax',
    'Secure',
    'HttpOnly',
  ].join('; ');
}

export function cookieSesionExpirada() {
  return 'usuario_id=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly';
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
  if (punto <= 0) return null;

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

export function esMismoOrigen(request) {
  const origen = request.headers.get('origin');
  if (!origen) return true; 

  let host = '';
  try {
    host = new URL(origen).host;
  } catch {
    return false;
  }

  const hostPropio =
    request.headers.get('x-forwarded-host') || request.headers.get('host') || '';

  if (!hostPropio) return true;
  if (host === hostPropio) return true;

  const origenCanonico = String(ENV.APP_ORIGIN || '').trim();
  if (origenCanonico) {
    try {
      if (host === new URL(origenCanonico).host) return true;
    } catch {
      void 0;
    }
  }

  return false;
}
