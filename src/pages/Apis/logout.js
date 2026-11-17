export const prerender = false;

import { cookieSesionExpirada, esMismoOrigen } from '../../Backend/sesion.js';

export async function POST({ request }) {
  if (!esMismoOrigen(request)) {
    return new Response(JSON.stringify({ error: 'Origen no permitido.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', cookieSesionExpirada());

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}
