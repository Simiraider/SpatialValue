import { leerFila, leerGlb } from '../../../Backend/gemelo-servidor.js';
import { MAX_GLB_BYTES } from '../../../Backend/visor-supabase.js';
import {
  descargarRemoto,
  exigirSesion,
  limitar,
  puedeAccederTrabajoGemelo,
} from '../../../Backend/seguridad.js';

export const prerender = false;

export async function GET({ params, url, request }) {
  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`gemelo-glb:${sesion.usuarioId}`, 120, 60_000))) {
    return new Response('Demasiadas descargas. Esperá un momento.', {
      status: 429,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const id = params.id;
  const descargar = url.searchParams.get('download') === '1';
  const descarga = {
    'Content-Disposition': `${descargar ? 'attachment' : 'inline'}; filename="gemelo-digital.glb"`,
    'X-Content-Type-Options': 'nosniff',
  };

  try {
    const fila = await leerFila(id);
    if (!fila) {
      return new Response('No encontrado', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    }
    if (!(await puedeAccederTrabajoGemelo(fila, sesion.usuarioId))) {
      return new Response('No autorizado', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    const local = await leerGlb(id);
    if (local?.bytes) {
      return new Response(local.bytes, {
        status: 200,
        headers: {
          'Content-Type': 'model/gltf-binary',
          'Cache-Control': 'private, max-age=31536000, immutable',
          'Content-Length': String(local.bytesLen || local.bytes.length),
          ...descarga,
        },
      });
    }

    if (!fila.modelo_url) {
      return new Response('No encontrado', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    }

    const remoto = await descargarRemoto(fila.modelo_url, {
      maxBytes: MAX_GLB_BYTES,
      timeoutMs: 60_000,
    });
    if (!remoto.ok) {
      return new Response(remoto.error, {
        status: remoto.status === 413 ? 413 : 502,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    const bytes = remoto.bytes;
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'model/gltf-binary',
        'Cache-Control': 'private, max-age=3600',
        'Content-Length': String(bytes.length),
        ...descarga,
      },
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : 'Error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
