export const prerender = false;
import sql from '../../Backend/carga.js';

export async function POST({ request }) {
  try {
    const { usuario, email, supabase_id } = await request.json();

    if (!usuario || !email) {
      return new Response(
        JSON.stringify({ error: "Datos incompletos" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const userId = supabase_id || crypto.randomUUID();

    const existe = await sql`SELECT "id_usuario" FROM "usuarios" WHERE "email" = ${email}`;
    if (existe.length > 0) {
      if (supabase_id && existe[0].id_usuario !== supabase_id) {
        await sql`UPDATE "usuarios" SET "id_usuario" = ${supabase_id} WHERE "email" = ${email}`;
      }
      return new Response(
        JSON.stringify({ success: true, message: "Usuario ya registrado", id: existe[0].id_usuario }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    await sql`
      INSERT INTO "usuarios" ("id_usuario", "nombre", "email", "contraseña", "email_verificado") 
      VALUES (${userId}, ${usuario}, ${email}, 'supabase-managed', TRUE)
      ON CONFLICT ("id_usuario") DO NOTHING
    `;

    return new Response(
      JSON.stringify({ success: true, message: "Usuario creado en base de datos", id: userId }),
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
