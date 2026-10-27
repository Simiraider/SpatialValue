import { leerFila, leerGlb } from '../../../Backend/gemelo-servidor.js';

export const prerender = false;

/**
 * GET /api/modelo/:id — entrega el .glb.
 *
 * Si el archivo está en la base (KIRI / subido a mano) se sirve desde ahí.
 * Si solo tenemos el enlace del proveedor (MakeSplat) se baja y se reenvía,
 * así el visor nunca depende de CORS o de enlaces firmados con vencimiento.
 * `?download=1` fuerza la descarga.
 */
export async function GET({ params, url }) {
  const id = params.id;
  const descargar = url.searchParams.get('download') === '1';
  const descarga = {
    'Content-Disposition': `${descargar ? 'attachment' : 'inline'}; filename="gemelo-digital.glb"`,
  };

  try {
    const local = await leerGlb(id);
    if (local?.bytes) {
      return new Response(local.bytes, {
        status: 200,
        headers: {
          'Content-Type': 'model/gltf-binary',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Length': String(local.bytesLen || local.bytes.length),
          ...descarga,
        },
      });
    }

    const fila = await leerFila(id);
    if (!fila?.modelo_url) {
      return new Response('No encontrado', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    }

    const remoto = await fetch(fila.modelo_url, { signal: AbortSignal.timeout(60000) });
    if (!remoto.ok) {
      return new Response(`El proveedor respondió ${remoto.status}`, {
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    const bytes = new Uint8Array(await remoto.arrayBuffer());
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'model/gltf-binary',
        'Cache-Control': 'public, max-age=3600',
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