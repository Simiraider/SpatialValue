export const prerender = false;
import sql from '../carga.js';
import bcrypt from 'bcryptjs';

export async function POST({ request }) {
  try {
    const { usuario, contraseña } = await request.json();

    const users = await sql`SELECT * FROM "Usuarios" WHERE "Nombre" = ${usuario}`;
    const user = users[0];

    if (!user) {
      return new Response(JSON.stringify({ error: "Usuario no encontrado" }), { status: 401 });
    }

    const esValida = await bcrypt.compare(contraseña, user.Contraseña);

    if (esValida) {
      return new Response(JSON.stringify({ success: true, username: user.Nombre }), { status: 200 });
    } else {
      return new Response(JSON.stringify({ error: "Clave incorrecta" }), { status: 401 });
    }
  } catch (error) {
    console.error("Error en login:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}