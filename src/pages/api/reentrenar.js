export const prerender = false;
import crypto from 'node:crypto';

const IA_URL = process.env.IA_URL || 'http://127.0.0.1:8000';
const IA_API_KEY = process.env.INTERNAL_API_KEY || '';

const igualSeguro = (a, b) => {
  const A = Buffer.from(String(a || ''));
  const B = Buffer.from(String(b || ''));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

export async function GET({ request }) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');
  if (!cronSecret || !igualSeguro(authorization, `Bearer ${cronSecret}`)) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${IA_URL}/reentrenar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': IA_API_KEY,
      },
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
