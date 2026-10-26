// src/pages/Apis/auth/google.js
// Paso 1 del login con Google: redirige a la pantalla de consentimiento de Google.
export const prerender = false;

import crypto from 'node:crypto';

const SCOPE = 'openid email profile';

export async function GET({ request }) {
  const clientId = import.meta.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return new Response('Falta configurar GOOGLE_CLIENT_ID en el servidor.', { status: 500 });
  }

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/Apis/auth/google/callback`;

  // Token anti-CSRF de un solo uso: se guarda en una cookie httpOnly de corta
  // vida y se compara contra el "state" que Google nos devuelva en el callback.
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    state,
    access_type: 'online',
    prompt: 'select_account',
  });

  const headers = new Headers({
    Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  });
  headers.append(
    'Set-Cookie',
    `oauth_state=${state}; Path=/; Max-Age=600; SameSite=Lax; Secure; HttpOnly`
  );

  return new Response(null, { status: 302, headers });
}