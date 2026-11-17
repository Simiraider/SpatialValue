import { ipDePeticion } from '../../Backend/sesion.js';
import { limitar } from '../../Backend/seguridad.js';

export const prerender = false;

export async function GET({ request }) {
  if (!(await limitar(`health:${ipDePeticion(request)}`, 120, 60_000))) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
