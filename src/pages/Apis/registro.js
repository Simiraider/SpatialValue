export const prerender = false;
import sql from '../../Backend/carga.js';
import argon2 from 'argon2';
import { cookieSesion, permitirFrecuencia, ipDePeticion } from '../../Backend/sesion.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOMBRE_RE = /^[\p{L}][\p{L}\s'.-]{1,99}$/u;
const MAX_EMAIL = 200;

function passwordValida(pwd) {
  return (
    typeof pwd === 'string' &&
    pwd.length >= 8 &&
    /[A-Z]/.test(pwd) &&
    /[0-9]/.test(pwd) &&
    /[^A-Za-z0-9]/.test(pwd)
  );
}

function normalizarNombre(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

export async function POST({ request }) {
  try {
    if (!permitirFrecuencia(`registro:${ipDePeticion(request)}`, 5, 3_600_000)) {
      return new Response(
        JSON.stringify({ error: "Demasiados registros desde esta conexión. Probá más tarde." }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    const body = await request.json().catch(() => null);
    const usuario = normalizarNombre(body?.usuario);
    const contraseña = String(body?.contraseña ?? '');
    const email = String(body?.email ?? '').trim().toLowerCase();

    if (!usuario || !contraseña || !email) {
      return new Response(
        JSON.stringify({ error: "Datos incompletos" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!NOMBRE_RE.test(usuario)) {
      return new Response(
        JSON.stringify({ error: "El nombre solo puede contener letras, espacios, puntos, apóstrofes y guiones." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL) {
      return new Response(
        JSON.stringify({ error: "Ingresá un email válido" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!passwordValida(contraseña)) {
      return new Response(
        JSON.stringify({ error: "La contraseña debe tener al menos 8 caracteres, una mayúscula, un número y un símbolo." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const existe = await sql`SELECT "id_usuario" FROM "usuarios" WHERE LOWER("nombre") = ${usuario.toLowerCase()}`;
    if (existe.length > 0) {
      return new Response(
        JSON.stringify({ error: "El nombre de usuario ya está en uso" }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    const existeMail = await sql`SELECT "id_usuario" FROM "usuarios" WHERE LOWER("email") = ${email}`;
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
      RETURNING "id_usuario"
    `;

    const usuarioId = nuevoUsuario[0].id_usuario;

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

    response.headers.append("Set-Cookie", cookieSesion(usuarioId));

    return response;

  } catch (error) {
    const mensaje = String(error?.message ?? '');
    if (mensaje.includes('value too long') || mensaje.includes('too long')) {
      return new Response(
        JSON.stringify({ error: "Alguno de los campos excede la longitud permitida" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    console.error("Error en registro:", error.message);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
