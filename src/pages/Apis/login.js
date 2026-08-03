export const prerender = false;
import sql from '../../Backend/carga.js';
import argon2 from 'argon2';

export async function POST({ request }) {
  try {
    const { email, contraseña } = await request.json();

    // 1. Buscamos al usuario (sin comillas dobles para evitar líos de mayúsculas)
    const users = await sql`SELECT * FROM usuarios WHERE email = ${email}`;
    const user = users[0];

    if (!user) {
      return new Response(JSON.stringify({ error: "El correo electrónico no está registrado" }), { 
        status: 401,
        headers: { "Content-Type": "application/json" } 
      });
    }

    // 2. Verificamos la contraseña
    const esValida = await argon2.verify(user.contraseña, contraseña);

    if (esValida) {
      const response = new Response(JSON.stringify({ 
        success: true, 
        username: user.nombre,
        email: user.email,
        id: user.id 
      }), { 
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

      response.headers.append(
        "Set-Cookie", 
        `usuario_id=${user.id}; Path=/; Max-Age=1800; SameSite=Lax`
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