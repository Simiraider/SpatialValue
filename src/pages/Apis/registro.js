export const prerender = false;
import sql from '../../Backend/carga.js';

export async function POST({ request }) {
  try {
    const { usuario, email, supabase_id } = await request.json();

    if (!usuario || !email || !supabase_id) {
      return new Response(
        JSON.stringify({ error: "Datos incompletos" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verificar si ya existe en Neon
    const existe = await sql`SELECT "id_usuario" FROM "usuarios" WHERE "email" = ${email}`;
    if (existe.length > 0) {
      // Ya existe, no duplicar
      return new Response(
        JSON.stringify({ success: true, message: "Usuario ya registrado en base de datos" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Crear usuario en Neon con el ID de Supabase Auth
    await sql`
      INSERT INTO "usuarios" ("id_usuario", "nombre", "email", "email_verificado") 
      VALUES (${supabase_id}, ${usuario}, ${email}, TRUE)
    `;

    return new Response(
      JSON.stringify({ success: true, message: "Usuario creado en base de datos" }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error en registro:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}