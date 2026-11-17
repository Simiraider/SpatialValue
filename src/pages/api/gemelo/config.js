import { visorOperativo } from '../../../Backend/visor-supabase.js';
import { exigirSesion, limitar, respuestaJson } from '../../../Backend/seguridad.js';

export const prerender = false;

export async function GET({ url, request }) {
  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`gemelo-config:${sesion.usuarioId}`, 120, 60_000))) {
    return respuestaJson(429, { error: 'Demasiadas consultas. Esperá un momento.' });
  }

  const conKiri = Boolean(process.env.KIRI_API_KEY);
  const conMakeSplat = Boolean(process.env.MAKESPLAT_API_KEY);
  const proveedor = conKiri ? 'kiri' : conMakeSplat ? 'makesplat' : null;
  const conSupabase = visorOperativo();

  return new Response(
    JSON.stringify({
      workerUrl: url.origin,
      minFotos: proveedor === 'kiri' ? 20 : 5,
      maxFotos: 100,
      maxVideoMb: 50,
      modo: proveedor ? 'auto' : 'simular',
      almacenamiento: conSupabase ? 'supabase' : 'servidor',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }
  );
}
