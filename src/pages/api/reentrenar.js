export const prerender = false;

const IA_URL = import.meta.env.IA_URL || process.env.IA_URL || 'http://127.0.0.1:8000';

// Cron de Vercel: reentrena el modelo en el servicio Python deployado (Render).
export async function GET() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${IA_URL}/reentrenar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    return new Response(
      JSON.stringify({ ok: res.ok, data }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } finally {
    clearTimeout(timer);
  }
}
