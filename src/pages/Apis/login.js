export const prerender = false;
import sql from '../../Backend/carga.js';
import argon2 from 'argon2';

export async function POST({ request }) {
  try {
    const { email, contraseña } = await request.json();

    const users = await sql`SELECT * FROM "Usuarios" WHERE "email" = ${email}`;
    const user = users[0];

    if (!user) {
      return new Response(JSON.stringify({ error: "El correo electrónico no está registrado" }), { status: 401 });
    }

    const esValida = await argon2.verify(user.Contraseña, contraseña);

    if (esValida) {
      return new Response(JSON.stringify({ 
        success: true, 
        username: user.Nombre,
        email: user.Email 
      }), { status: 200 });
    } else {
      return new Response(JSON.stringify({ error: "Contraseña incorrecta" }), { status: 401 });
    }

  } catch (error) {
    console.error("Error en login:", error.message);
    return new Response(JSON.stringify({ error: "Error en el servidor" }), { status: 500 });
  }
}