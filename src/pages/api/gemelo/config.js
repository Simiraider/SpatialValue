import { visorOperativo } from '../../../Backend/visor-supabase.js';

export const prerender = false;

export async function GET({ url }) {
  const conKiri = Boolean(process.env.KIRI_API_KEY);
  const conMakeSplat = Boolean(
    process.env.MAKESPLAT_API_KEY
  );
  const proveedor = conKiri ? 'kiri' : conMakeSplat ? 'makesplat' : null;
  const conSupabase = visorOperativo();

  return new Response(
    JSON.stringify({
      workerUrl: url.origin,
      minFotos: proveedor === 'kiri' ? 20 : 5,
      maxFotos: 300,
      maxVideoMb: 500,
      modo: proveedor ? 'auto' : 'simular',
      almacenamiento: conSupabase ? 'supabase' : 'servidor',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }
  );
}