export const prerender = false;

/**
 * Devuelve la configuración del motor 3D a la UI.
 *
 * `workerUrl` es el mismo origen de la app: así la UI habla con /api/jobs
 * (el adaptador de KIRI/MakeSplat) en lugar del worker COLMAP local.
 * Ojo: no puede ser cadena vacía, `obtenerConfigGemelo()` la trata como "sin configurar".
 */
export async function GET({ url }) {
  const conKiri = Boolean(import.meta.env.KIRI_API_KEY || process.env.KIRI_API_KEY);
  const conMakeSplat = Boolean(
    import.meta.env.MAKESPLAT_API_KEY || process.env.MAKESPLAT_API_KEY
  );
  const proveedor = conKiri ? 'kiri' : conMakeSplat ? 'makesplat' : null;

  return new Response(
    JSON.stringify({
      workerUrl: url.origin,
      minFotos: proveedor === 'kiri' ? 20 : 5,
      maxFotos: 300,
      maxVideoMb: 500,
      modo: proveedor ? 'auto' : 'simular',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }
  );
}