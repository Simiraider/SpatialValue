import dns from 'node:dns/promises';
import net from 'node:net';
import sql from './carga.js';
import { esMismoOrigen, resolverUsuarioId } from './sesion.js';
import { permitirFrecuencia } from './limite.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HOSTS_BLOQUEADOS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

export const esUuid = (valor) => UUID_RE.test(String(valor || ''));

export const respuestaJson = (status, cuerpo) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });

export function origenDe(request) {
  const configurado = String(process.env.APP_ORIGIN || '').trim().replace(/\/+$/, '');
  if (configurado) return configurado;

  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') return null;

  const host =
    request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  if (!host) return null;

  const proto = request.headers.get('x-forwarded-proto') || 'https';
  if (proto !== 'https' && process.env.NODE_ENV === 'production') return null;
  return `${proto}://${host}`;
}

export function exigirSesion(request, { origen = true } = {}) {
  if (origen && !esMismoOrigen(request)) {
    return { error: respuestaJson(403, { error: 'Origen no permitido.' }) };
  }

  const usuarioId = resolverUsuarioId(request);
  if (!usuarioId) {
    return { error: respuestaJson(401, { error: 'Sesión no válida. Volvé a iniciar sesión.' }) };
  }

  return { usuarioId };
}

export function limitar(clave, maximo, ventanaMs) {
  return permitirFrecuencia(clave, maximo, ventanaMs);
}

export async function esPublicacionDelUsuario(usuarioId, publicacionId) {
  if (!esUuid(publicacionId)) return false;
  try {
    const filas = await sql`
      SELECT 1 FROM publicaciones
      WHERE id_publicacion = ${publicacionId}::uuid AND id_usuario = ${usuarioId}
      LIMIT 1
    `;
    return filas.length > 0;
  } catch {
    return false;
  }
}

export async function puedeAccederTrabajo(fila, usuarioId) {
  if (!fila) return false;
  if (fila.usuario_id) return String(fila.usuario_id) === String(usuarioId);
  if (fila.publicacion_id) return esPublicacionDelUsuario(usuarioId, fila.publicacion_id);
  return false;
}

export async function puedeAccederTrabajoGemelo(fila, usuarioId) {
  if (!fila) return false;
  if (fila.id_usuario) return String(fila.id_usuario) === String(usuarioId);
  if (fila.id_publicacion) return esPublicacionDelUsuario(usuarioId, fila.id_publicacion);
  return false;
}

const ipv4Privada = (ip) => {
  const partes = ip.split('.').map(Number);
  if (partes.length !== 4 || partes.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = partes;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
};

const ipv6Privada = (ip) => {
  const valor = ip.toLowerCase();
  if (valor === '::' || valor === '::1') return true;
  if (valor.startsWith('fc') || valor.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(valor)) return true;
  if (valor.startsWith('::ffff:')) return ipv4Privada(valor.slice(7));
  return false;
};

export const ipPrivada = (ip) => {
  const valor = String(ip || '').replace(/^\[|\]$/g, '');
  if (!net.isIP(valor)) return true;
  return net.isIP(valor) === 4 ? ipv4Privada(valor) : ipv6Privada(valor);
};

export async function urlRemotaSegura(valor) {
  let url;
  try {
    url = new URL(String(valor || ''));
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '443') return null;

  const host = url.hostname.toLowerCase();
  if (!host || HOSTS_BLOQUEADOS.has(host)) return null;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return null;
  }

  if (net.isIP(host)) return ipPrivada(host) ? null : url;

  try {
    const direcciones = await dns.lookup(host, { all: true, verbatim: true });
    if (!direcciones.length) return null;
    if (direcciones.some((d) => ipPrivada(d.address))) return null;
  } catch {
    return null;
  }

  return url;
}

export async function descargarRemoto(valor, { maxBytes, timeoutMs = 30_000 } = {}) {
  const limite = Number(maxBytes) > 0 ? Number(maxBytes) : 50 * 1024 * 1024;
  let actual = String(valor || '');

  for (let salto = 0; salto < 3; salto += 1) {
    const url = await urlRemotaSegura(actual);
    if (!url) return { ok: false, status: 400, error: 'La URL no es pública o no usa https.' };

    const respuesta = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'SpatialValue/1.0',
        Accept: 'model/gltf-binary,application/octet-stream,*/*',
      },
    });

    if (respuesta.status >= 300 && respuesta.status < 400) {
      const destino = respuesta.headers.get('location');
      await respuesta.body?.cancel?.().catch(() => {});
      if (!destino) return { ok: false, status: 502, error: 'Redirección inválida.' };
      actual = new URL(destino, url).toString();
      continue;
    }

    if (!respuesta.ok) {
      return { ok: false, status: 502, error: `El origen respondió HTTP ${respuesta.status}.` };
    }

    const declarado = Number(respuesta.headers.get('content-length')) || 0;
    if (declarado > limite) {
      return {
        ok: false,
        status: 413,
        error: `El archivo supera el máximo de ${Math.round(limite / 1024 / 1024)} MB.`,
      };
    }

    const lector = respuesta.body?.getReader();
    if (!lector) return { ok: false, status: 502, error: 'La respuesta llegó vacía.' };

    const trozos = [];
    let total = 0;

    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.length;
      if (total > limite) {
        await lector.cancel().catch(() => {});
        return {
          ok: false,
          status: 413,
          error: `El archivo supera el máximo de ${Math.round(limite / 1024 / 1024)} MB.`,
        };
      }
      trozos.push(value);
    }

    const bytes = new Uint8Array(total);
    let desplazamiento = 0;
    for (const trozo of trozos) {
      bytes.set(trozo, desplazamiento);
      desplazamiento += trozo.length;
    }

    return { ok: true, bytes };
  }

  return { ok: false, status: 400, error: 'Demasiadas redirecciones.' };
}
