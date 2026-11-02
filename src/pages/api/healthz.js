import {
  BUCKET,
  TABLA,
  claveEsPublica,
  tipoClave,
  visorConfigurado,
  visorOperativo,
} from '../../Backend/visor-supabase.js';

export const prerender = false;
export async function GET() {
  const conKiri = Boolean(process.env.KIRI_API_KEY);
  const conMakeSplat = Boolean(
    process.env.MAKESPLAT_API_KEY
  );
  const modo = conKiri ? 'kiri' : conMakeSplat ? 'makesplat' : 'simular';
  const conSupabase = visorOperativo();

  return new Response(
    JSON.stringify({
      modo,
      motor: 'adaptador',
      proveedor: conKiri ? 'kiri-engine' : conMakeSplat ? 'makesplat' : 'demostración',
      colmapInstalado: true,
      denseHabilitado: false,
      kaggleListo: false,
      visor: {
        almacenamiento: conSupabase ? 'supabase' : 'servidor',
        supabaseConfigurado: visorConfigurado(),
        tipoClave: tipoClave(),
        clavePublica: claveEsPublica(),
        bucket: conSupabase ? BUCKET : null,
        tabla: conSupabase ? TABLA : null,
        puedeAlmacenar: conSupabase,
        puedeReconstruir: Boolean(conKiri || conMakeSplat),
      },
      ok: true,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }
  );
}