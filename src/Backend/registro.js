export const prerender = false;
import sql from '../carga.js';
import { argon2id } from 'hash-wasm';

export async function POST({ request }) {
  try {
    const { usuario, contraseña, email } = await request.json();

    if (!usuario || !contraseña || !email) {
      return new Response(JSON.stringify({ error: "Datos incompletos" }), { status: 400 });
    }

    const existe = await sql`SELECT "ID" FROM "Usuarios" WHERE "Nombre" = ${usuario}`;
    
    if (existe.length > 0) {
      return new Response(JSON.stringify({ error: "El usuario ya existe" }), { status: 400 });
    }
    const existeMail = await sql`SELECT "ID" FROM "Usuarios" WHERE "email" = ${email}`;
    
    if (existeMail.length > 0) {
      return new Response(JSON.stringify({ error: "El usuario ya existe" }), { status: 400 });
    }

    const salt = crypto.getRandomValues(new Uint8Array(16)); 
    const hash = await argon2id({
      password: contraseña,
      salt: salt,
      parallelism: 1,
      iterations: 2,
      memorySize: 16384,
      hashLength: 32,
      outputType: 'encoded',
    });
    
    await sql`
      INSERT INTO "Usuarios" ("Nombre", "Contraseña") 
      VALUES (${usuario}, ${hash}, ${email})
    `;

    return new Response(JSON.stringify({ success: true, message: "Usuario creado" }), { status: 201 });

  } catch (error) {
    console.error("Error en registro:", error.message);
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), { status: 500 });
  }
}