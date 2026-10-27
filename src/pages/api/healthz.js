export const prerender = false;

/**
 * Health check del motor 3D. La UI lo llama con `probarConexionWorker()`
 * antes de habilitar la subida; si responde 200 el flujo arranca.
 */
export async function GET() {
  const conKiri = Boolean(import.meta.env.KIRI_API_KEY || process.env.KIRI_API_KEY);
  const conMakeSplat = Boolean(
    import.meta.env.MAKESPLAT_API_KEY || process.env.MAKESPLAT_API_KEY
  );
  const modo = conKiri ? 'kiri' : conMakeSplat ? 'makesplat' : 'simular';

  return new Response(
    JSON.stringify({
      modo,
      motor: 'adaptador',
      proveedor: conKiri ? 'kiri-engine' : conMakeSplat ? 'makesplat' : 'demostración',
      colmapInstalado: true,
      denseHabilitado: false,
      kaggleListo: false,
      ok: true,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }
  );
}