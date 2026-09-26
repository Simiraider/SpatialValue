export const prerender = false;
import sql from '../../Backend/carga.js';
import sqlConfig, { asegurarEsquemaConfig } from '../../Backend/carga-config.js';
import argon2 from 'argon2';
import { cookieSesion, permitirFrecuencia, ipDePeticion } from '../../Backend/sesion.js';

export async function POST({ request }) {
  try {
    if (!permitirFrecuencia(`login:${ipDePeticion(request)}`, 10)) {
      return new Response(
        JSON.stringify({ error: "Demasiados intentos. Esperá unos minutos y probá de nuevo." }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    const body = await request.json().catch(() => null);
    const email = String(body?.email ?? '').trim().toLowerCase();
    const contraseña = String(body?.contraseña ?? '');

    if (!email || !contraseña) {
      return new Response(
        JSON.stringify({ error: "Email y contraseña son obligatorios" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const users = await sql`SELECT * FROM usuarios WHERE LOWER(email) = ${email}`;
    const user = users[0];

    const credencialesInvalidas = () =>
      new Response(JSON.stringify({ error: "Credenciales inválidas" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });

    if (!user) {
      await argon2.hash(contraseña, { type: argon2.argon2id, parallelism: 1, timeCost: 2, memoryCost: 16384 }).catch(() => {});
      return credencialesInvalidas();
    }

    const esValida = await argon2.verify(user.contraseña, contraseña);
    if (!esValida) return credencialesInvalidas();

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
      return new Response(JSON.stringify({ error: 'Tu cuenta está desactivada. Contactá a soporte para reactivarla.' }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }

    const response = new Response(JSON.stringify({
      success: true,
      username: user.nombre,
      email: user.email,
      id: user.id_usuario
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

    response.headers.append("Set-Cookie", cookieSesion(user.id_usuario));

    return response;

  } catch (error) {
    console.error("Error en login:", error.message);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
