export const prerender = false;
import sql from '../carga.js';
import bcrypt from 'bcryptjs';

export async function POST({ request }) {
  try {
    const { usuario, contraseña } = await request.json();

    if (!usuario || !contraseña) {
      return new Response(JSON.stringify({ error: "Datos incompletos" }), { status: 400 });
    }
    const existe = await sql`SELECT "ID" FROM "Usuarios" WHERE "Nombre" = ${usuario}`;
    
    if (existe.length > 0) {
      return new Response(JSON.stringify({ error: "El usuario ya existe" }), { status: 400 });
    }

    const hash = await bcrypt.hash(contraseña, 10);

    await sql`
      INSERT INTO "Usuarios" ("Nombre", "Contraseña") 
      VALUES (${usuario}, ${hash})
    `;

    return new Response(JSON.stringify({ success: true }), { status: 201 });
  } catch (error) {
    console.error("Error en registro:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}