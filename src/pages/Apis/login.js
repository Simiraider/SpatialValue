export const prerender = false;
import sql from '../../Backend/carga.js';
import sqlConfig from '../../Backend/carga-config.js';
import argon2 from 'argon2';

export async function POST({ request }) {
  try {
    const { email, contraseña } = await request.json();

    if (!email || !contraseña) {
      return new Response(
        JSON.stringify({ error: "Email y contraseña son obligatorios" }), 
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const users = await sql`SELECT * FROM usuarios WHERE email = ${email}`;
    const user = users[0];

    if (!user) {
      return new Response(JSON.stringify({ error: "El correo electrónico no está registrado" }), { 
        status: 401,
        headers: { "Content-Type": "application/json" } 
      });
    }

    const esValida = await argon2.verify(user.contraseña, contraseña);

    let cuentaActiva = true;
    try {
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

    if (esValida) {
      const response = new Response(JSON.stringify({ 
        success: true, 
        username: user.nombre,
        email: user.email,
        id: user.id_usuario
      }), { 
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

      response.headers.append(
        "Set-Cookie", 
        `usuario_id=${user.id_usuario}; Path=/; Max-Age=604800; SameSite=Lax; Secure; HttpOnly`
      );

      return response;

    } else {
      return new Response(JSON.stringify({ error: "Contraseña incorrecta" }), { 
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

  } catch (error) {
    console.error("Error en login:", error.message);
    return new Response(JSON.stringify({ error: "Error en el servidor" }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}