import {
  descargarObjeto,
  errorConfiguracion,
  leerFila,
  visorOperativo,
} from '../../../../Backend/visor-supabase.js';

export const prerender = false;

const texto = (mensaje, status) =>
  new Response(mensaje, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

export async function GET({ params, url }) {
  if (!visorOperativo()) return texto(errorConfiguracion(), 503);

  try {
    const fila = await leerFila(params.id);
    if (!fila?.modelo_path) return texto('Este trabajo no tiene modelo.', 404);

    const objeto = await descargarObjeto(fila.modelo_path);
    if (!objeto.ok || !objeto.body) {
      return texto(`No se pudo leer el modelo (HTTP ${objeto.status}).`, 502);
    }

    const descargar = url.searchParams.get('download') === '1';
    const cabeceras = {
      'Content-Type': 'model/gltf-binary',
      'Cache-Control': 'public, max-age=3600',
      'Content-Disposition': `${descargar ? 'attachment' : 'inline'}; filename="gemelo-digital.glb"`,
    };
    const tamano = objeto.headers.get('content-length');
    if (tamano) cabeceras['Content-Length'] = tamano;

    return new Response(objeto.body, { status: 200, headers: cabeceras });
  } catch (e) {
    return texto(e instanceof Error ? e.message : 'Error sirviendo el modelo.', 500);
  }
}
