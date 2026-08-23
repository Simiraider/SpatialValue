export const prerender = false;
import sql from '../../Backend/carga.js';
import argon2 from 'argon2';
import { enviarMailVerificacion } from '../../lib/mailer.js';

export async function POST({ request }) {
  try {
    const { usuario, contraseña, email } = await request.json();

    if (!usuario || !contraseña || !email) {
      return new Response( 
        JSON.stringify({ error: "Datos incompletos" }), 
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const existe = await sql`SELECT "id_usuario" FROM "usuarios" WHERE "nombre" = ${usuario}`;
    if (existe.length > 0) {
      return new Response(
        JSON.stringify({ error: "El nombre de usuario ya está en uso" }), 
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const existeMail = await sql`SELECT "id_usuario" FROM "usuarios" WHERE "email" = ${email}`;
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

    const tokenVerificacion = crypto.randomUUID();

    await sql`
      INSERT INTO "usuarios" ("nombre", "contraseña", "email", "token_verificacion", "email_verificado") 
      VALUES (${usuario}, ${hash}, ${email}, ${tokenVerificacion}, FALSE)
    `;    let emailEnviado = false;
    try {
      emailEnviado = await enviarMailVerificacion(email, usuario, tokenVerificacion);
    } catch (emailError) {
      console.error('Error al enviar email de verificación:', emailError.message);
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: emailEnviado
          ? "Usuario registrado. Revisa tu casilla para confirmar la cuenta."
          : "Usuario registrado. No pudimos enviar el email de verificación, pero tu cuenta fue creada."
      }),
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