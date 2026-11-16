export const prerender = false;

/**
 * Healthcheck publico.
 *
 * Deliberadamente NO expone que proveedor 3D esta configurado, ni nombres de
 * bucket, tabla o tipo de clave: eso le sirve a un atacante para mapear el
 * backend. Para diagnostico interno existe /api/gemelo/config.
 */
export async function GET() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
