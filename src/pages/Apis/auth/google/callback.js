export const prerender = false;

import crypto from 'node:crypto';
import argon2 from 'argon2';
import sql from '../../../../Backend/carga.js';
import sqlConfig, { asegurarEsquemaConfig } from '../../../../Backend/carga-config.js';
import { cookieSesion } from '../../../../Backend/sesion.js';
const clientId = (import.meta.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '').trim();
const clientSecret = (import.meta.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '').trim();
const redirectUri = (import.meta.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI || '').trim();

function leerCookie(request, nombre) {
  const cookies = request.headers.get('cookie') || '';
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${nombre}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

const cookieEstadoVencida = () =>
  'oauth_state=; Max-Age=0; Path=/; SameSite=Lax; Secure; HttpOnly';

function redirigirALogin(motivo) {
  const headers = new Headers({ Location: `/login?error=${encodeURIComponent(motivo)}` });
  headers.append('Set-Cookie', cookieEstadoVencida());
  return new Response(null, { status: 302, headers });
}

export async function GET({ request }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateRecibido = url.searchParams.get('state');
  const errorGoogle = url.searchParams.get('error');

  if (errorGoogle) {
    return redirigirALogin('Acceso con Google cancelado.');
  }

  const stateCookie = leerCookie(request, 'oauth_state');
  if (!code || !stateRecibido || !stateCookie || stateRecibido !== stateCookie) {
    return redirigirALogin('No pudimos verificar el pedido de acceso con Google. Probá de nuevo.');
  }

  const clientId = (import.meta.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (import.meta.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '').trim();

  if (!clientId || !clientSecret) {
    return new Response('Faltan credenciales de Google en el servidor.', { status: 500 });
  }

  const redirectUri = `${url.origin}/Apis/auth/google/callback`;

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      console.error('Google token exchange falló:', await tokenRes.text().catch(() => ''));
      return redirigirALogin('No pudimos validar tu cuenta de Google. Probá de nuevo.');
    }

    const tokenData = await tokenRes.json();

    const perfilRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!perfilRes.ok) {
      return redirigirALogin('No pudimos obtener tu perfil de Google.');
    }

    const perfil = await perfilRes.json();

    if (!perfil.email || perfil.email_verified === false) {
      return redirigirALogin('Tu cuenta de Google no tiene un email verificado.');
    }

    const email = String(perfil.email).trim().toLowerCase();
    const nombre = perfil.name || email.split('@')[0];

    // 3) Buscar el usuario; si no existe, se crea.
    const existentes = await sql`SELECT * FROM usuarios WHERE LOWER(email) = ${email}`;
    let user = existentes[0];

    if (!user) {
      const passwordAleatoria = crypto.randomBytes(32).toString('hex');
      const hashInutilizable = await argon2.hash(passwordAleatoria, {
        type: argon2.argon2id,
        parallelism: 1,
        timeCost: 2,
        memoryCost: 16384,
      });

      const creados = await sql`
        INSERT INTO usuarios (nombre, email, "contraseña")
        VALUES (${nombre}, ${email}, ${hashInutilizable})
        RETURNING *
      `;
      user = creados[0];
    }

    let cuentaActiva = true;
    try {
      await asegurarEsquemaConfig();
      const configRows = await sqlConfig`
        SELECT "cuenta_activa" FROM "usuarios" WHERE "id_usuario" = ${user.id_usuario} LIMIT 1
      `;
      if (configRows.length > 0 && configRows[0].cuenta_activa === false) {
        cuentaActiva = false;
      }
    } catch (e) {
      console.warn('No se pudo verificar el estado de la cuenta:', e.message);
    }

    if (!cuentaActiva) {
      return redirigirALogin('Tu cuenta está desactivada. Contactá a soporte para reactivarla.');
    }
    const destino = new URL('/dashboard', url.origin);
    destino.searchParams.set('bienvenida', '1');
    destino.searchParams.set('nombre', nombre);
    destino.searchParams.set('uid', user.id_usuario);

    const headers = new Headers({ Location: destino.toString() });
    headers.append('Set-Cookie', cookieSesion(user.id_usuario));
    headers.append('Set-Cookie', cookieEstadoVencida());

    return new Response(null, { status: 302, headers });

  } catch (error) {
    console.error('Error en login con Google:', error.message);
    return redirigirALogin('Error interno al iniciar sesión con Google.');
  }
}