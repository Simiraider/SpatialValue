export const prerender = false;
import sql from '../../Backend/carga.js';
import argon2 from 'argon2';

export async function POST({ request }) {
  try {
    const { usuario, email: emailField, contraseña } = await request.json();
    const busqueda = usuario || emailField;

    if (!busqueda || !contraseña) {
      return new Response(
        JSON.stringify({ error: "Faltan campos requeridos" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const usuarios = await sql`
      SELECT "id_usuario", "nombre", "contraseña", "email_verificado" 
      FROM "usuarios" 
      WHERE "nombre" = ${busqueda} OR "email" = ${busqueda}
    `;

    if (usuarios.length === 0) {
      return new Response(
        JSON.stringify({ error: "Usuario o contraseña incorrectos" }), 
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const user = usuarios[0];

    if (!user.email_verificado) {
      return new Response(
        JSON.stringify({ error: "Debes verificar tu correo electrónico antes de iniciar sesión. Revisa tu casilla." }), 
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const passwordValido = await argon2.verify(user.contraseña, contraseña);

    if (!passwordValido) {
      return new Response(
        JSON.stringify({ error: "Usuario o contraseña incorrectos" }), 
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }    const response = new Response(
      JSON.stringify({ success: true, message: "Sesión iniciada", username: user.nombre, id: user.id_usuario }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    response.headers.append(
      "Set-Cookie", 
      `usuario_id=${user.id_usuario}; Path=/; Max-Age=1800; SameSite=Lax; Secure`
    );

    return response;

  } catch (error) {
    console.error("Error en login:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }), 
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}