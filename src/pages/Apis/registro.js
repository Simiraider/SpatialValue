export const prerender = false;
import sql from '../../Backend/carga.js';
import argon2 from 'argon2';
export async function POST({ request }) {
  try {
    const { usuario, contraseña, email } = await request.json();

    if (!usuario || !contraseña || !email) {
      return new Response( 
        JSON.stringify({ error: "Datos incompletos" }), 
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const existe = await sql`SELECT "id" FROM "usuarios" WHERE "nombre" = ${usuario}`;
    if (existe.length > 0) {
      return new Response(
        JSON.stringify({ error: "El nombre de usuario ya está en uso" }), 
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const existeMail = await sql`SELECT "id" FROM "usuarios" WHERE "email" = ${email}`;
    if (existeMail.length > 0) {
      return new Response(
        JSON.stringify({ error: "El correo electrónico ya está registrado" }), 
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const hash = await argon2.hash(contraseña, {
      type: argon2.argon2id,
      parallelism: 1,
      timeCost: 2,       
      memoryCost: 16384, 
    });
    const nuevoUsuario = await sql`
      INSERT INTO "usuarios" ("nombre", "contraseña", "email") 
      VALUES (${usuario}, ${hash}, ${email})
      RETURNING "id"
    `;
    
    const usuarioId = nuevoUsuario[0].id;

    const response = new Response(
      JSON.stringify({ 
        success: true, 
        message: "Usuario creado e iniciado sesión",
        username: usuario,
        email: email,
        id: usuarioId
      }), 
      { status: 201, headers: { "Content-Type": "application/json" } }
    );

    response.headers.append(
      "Set-Cookie", 
      `usuario_id=${usuarioId}; Path=/; Max-Age=1800; SameSite=Lax; Secure`
    );

    return response;

  } catch (error) {
    console.error("Error en registro:", error.message);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }), 
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}