export const prerender = false;

import argon2 from 'argon2';
import sql from '../../Backend/carga.js';
import { leerTokenValido, marcarUsado, borrarSolicitudesDe } from '../../Backend/recuperacion.js';
import { ipDePeticion, esMismoOrigen } from '../../Backend/sesion.js';
import { permitirFrecuencia } from '../../Backend/limite.js';

function json(cuerpo, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const MSG_PASSWORD =
  'La contraseña debe tener al menos 8 caracteres, una mayúscula, un número y un símbolo.';

function passwordValida(pwd) {
  return (
    typeof pwd === 'string' &&
    pwd.length >= 8 &&
    /[A-Z]/.test(pwd) &&
    /[0-9]/.test(pwd) &&
    /[^A-Za-z0-9]/.test(pwd)
  );
}

export async function POST({ request }) {
  try {
    if (!esMismoOrigen(request)) {
      return json({ error: 'Origen no permitido.' }, 403);
    }

    if (!(await permitirFrecuencia(`restablecer:${ipDePeticion(request)}`, 10, 900_000))) {
      return json({ error: 'Demasiados intentos. Esperá unos minutos.' }, 429);
    }

    const body = await request.json().catch(() => null);
    const token = String(body?.token ?? '').trim();
    const password = String(body?.password ?? '');
    const passwordConfirm = String(body?.password_confirm ?? '');

    if (!token) {
      return json({ error: 'Falta el token del enlace. Pedí uno nuevo.' }, 400);
    }

    if (!passwordValida(password)) {
      return json({ error: MSG_PASSWORD }, 400);
    }

    if (password !== passwordConfirm) {
      return json({ error: 'Las contraseñas no coinciden.' }, 400);
    }

    const fila = await leerTokenValido(token);
    if (!fila) {
      return json(
        { error: 'El enlace no es válido o ya venció. Pedí uno nuevo desde "Recuperar contraseña".' },
        400
      );
    }

    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      parallelism: 1,
      timeCost: 2,
      memoryCost: 16384,
    });

    await sql`
      UPDATE "usuarios" SET "contraseña" = ${hash} WHERE "id_usuario" = ${fila.id_usuario}
    `;

    await marcarUsado(fila.id);
    await borrarSolicitudesDe(fila.id_usuario);

    return json({
      success: true,
      mensaje: 'Contraseña actualizada. Ya podés iniciar sesión con la nueva.',
    });
  } catch (error) {
    console.error('Error en restablecer:', error?.message || error);
    return json({ error: 'No pudimos cambiar la contraseña. Probá de nuevo.' }, 500);
  }
}
