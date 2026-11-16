export const prerender = false;

import { cookieSesionExpirada } from '../../Backend/sesion.js';

export async function POST() {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', cookieSesionExpirada());

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}
