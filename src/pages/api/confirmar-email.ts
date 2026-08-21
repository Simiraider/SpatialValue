export const prerender = false;
import type { APIRoute } from 'astro';
import sql from '../../Backend/carga.js';

export const GET: APIRoute = async ({ url, redirect }) => {
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response("Token de activación no proporcionado", { status: 400 });
  }

  const usuario = await sql`
    SELECT "id_usuario" FROM "usuarios" WHERE "token_verificacion" = ${token}
  `;

  if (usuario.length === 0) {
    return new Response("El token es inválido o ya fue utilizado", { status: 400 });
  }
  await sql`
    UPDATE "usuarios" 
    SET "email_verificado" = TRUE, "token_verificacion" = NULL 
    WHERE "id_usuario" = ${usuario[0].id_usuario}
  `;

  return redirect('/login?verificado=true', 302);
};