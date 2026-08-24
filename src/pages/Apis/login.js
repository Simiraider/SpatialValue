export const prerender = false;
import sql from '../../Backend/carga.js';

// Este endpoint ahora solo sirve para obtener datos del usuario desde Neon
// El login real lo maneja Supabase Auth en el frontend
export async function POST({ request }) {
  try {
    const { supabase_id } = await request.json();

    if (!supabase_id) {
      return new Response(
        JSON.stringify({ error: "Falta el ID de usuario" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const usuarios = await sql`
      SELECT "id_usuario", "nombre", "email"
      FROM "usuarios"
      WHERE "id_usuario" = ${supabase_id}
    `;

    if (usuarios.length === 0) {
      return new Response(
        JSON.stringify({ error: "Usuario no encontrado en la base de datos" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const user = usuarios[0];

    return new Response(
      JSON.stringify({ 
        success: true, 
        username: user.nombre, 
        id: user.id_usuario,
        email: user.email,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error al obtener usuario:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
