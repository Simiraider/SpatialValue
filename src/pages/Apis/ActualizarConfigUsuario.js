export const prerender = false;
import sqlConfig from '../../Backend/carga-config.js';
import sqlIdentidad from '../../Backend/carga.js';

const AVATAR_MAX_BYTES = 300_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function esConfigUsuario(v) {
  if (!v || typeof v !== 'object') return false;
  return (
    typeof v.telefono === 'string' &&
    typeof v.avatar === 'string' &&
    typeof v.instagram === 'string' &&
    typeof v.twitter === 'string' &&
    typeof v.linkedin === 'string' &&
    typeof v.facebook === 'string' &&
    typeof v.perfil_publico === 'boolean' &&
    typeof v.mostrar_contacto === 'boolean' &&
    (v.moneda === 'USD' || v.moneda === 'ARS')
  );
}

function getCookieUsuarioId(request) {
  const cookies = request.headers.get('cookie') || '';
  const m = cookies.match(/(?:^|;\s*)usuario_id=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function respuestaError(mensaje, status) {
  return new Response(
    JSON.stringify({ error: mensaje }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}

async function asegurarUsuarioEnConfig(usuarioId) {
  const existente = await sqlConfig`
    SELECT "id_usuario" FROM "usuarios" WHERE "id_usuario" = ${usuarioId} LIMIT 1
  `;
  if (existente.length > 0) return;

  const identidad = await sqlIdentidad`
    SELECT "nombre", "email" FROM "usuarios" WHERE "id_usuario" = ${usuarioId} LIMIT 1
  `;
  if (identidad.length === 0) {
    throw new Error('Usuario no encontrado en la base de identidad');
  }

  await sqlConfig`
    INSERT INTO "usuarios" ("id_usuario", "nombre", "email", "contraseña")
    VALUES (${usuarioId}, ${identidad[0].nombre}, ${identidad[0].email}, '')
    ON CONFLICT ("id_usuario") DO NOTHING
  `;
}

export async function POST({ request }) {
  try {
    const usuarioId = getCookieUsuarioId(request);

    if (!usuarioId || usuarioId === 'undefined' || usuarioId === 'null') {
      return respuestaError('Sesión no válida', 401);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return respuestaError('Cuerpo de la petición inválido', 400);
    }

    const { config, passwordActual } = body;

    if (body.passwordNueva !== undefined) {
      if (!passwordActual || !body.passwordNueva) {
        return respuestaError('Faltan la contraseña actual o la nueva', 400);
      }
      if (body.passwordNueva !== body.passwordConfirm) {
        return respuestaError('Las contraseñas nuevas no coinciden', 400);
      }

      const users = await sqlIdentidad`
        SELECT "contraseña" FROM "usuarios" WHERE "id_usuario" = ${usuarioId} LIMIT 1
      `;
      if (!users || users.length === 0) {
        return respuestaError('Usuario no encontrado', 404);
      }

      const argon2 = (await import('argon2')).default;
      const esValida = await argon2.verify(users[0].contraseña, passwordActual);
      if (!esValida) {
        return respuestaError('La contraseña actual es incorrecta', 403);
      }

      const hash = await argon2.hash(body.passwordNueva, {
        type: argon2.argon2id,
        parallelism: 1,
        timeCost: 2,
        memoryCost: 16384,
      });

      await sqlIdentidad`
        UPDATE "usuarios" SET "contraseña" = ${hash} WHERE "id_usuario" = ${usuarioId}
      `;

      return new Response(
        JSON.stringify({ success: true, message: 'Contraseña actualizada' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!esConfigUsuario(config)) {
      return respuestaError('Configuración inválida', 400);
    }

    if (config.avatar && config.avatar.length > AVATAR_MAX_BYTES) {
      return respuestaError('La imagen de avatar es demasiado grande', 413);
    }

    let emailFinal = null;
    if (typeof body.email === 'string' && body.email.trim()) {
      const email = body.email.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        return respuestaError('El formato del email es inválido', 400);
      }
      const duenio = await sqlIdentidad`
        SELECT "id_usuario" FROM "usuarios" WHERE "email" = ${email} LIMIT 1
      `;
      if (duenio.length > 0 && String(duenio[0].id_usuario) !== String(usuarioId)) {
        return respuestaError('Ese email ya está registrado por otro usuario', 409);
      }
      emailFinal = email;
    }

    await asegurarUsuarioEnConfig(usuarioId);

    const updated = emailFinal
      ? await sqlConfig`
          UPDATE "usuarios" SET
            "telefono"         = ${config.telefono},
            "avatar"           = ${config.avatar},
            "instagram"        = ${config.instagram},
            "twitter"          = ${config.twitter},
            "linkedin"         = ${config.linkedin},
            "facebook"         = ${config.facebook},
            "perfil_publico"   = ${config.perfil_publico},
            "mostrar_contacto" = ${config.mostrar_contacto},
            "moneda"           = ${config.moneda},
            "email"            = ${emailFinal}
          WHERE "id_usuario" = ${usuarioId}
          RETURNING "nombre", "email", "telefono", "avatar", "instagram", "twitter",
                    "linkedin", "facebook", "perfil_publico", "mostrar_contacto", "moneda"
        `
      : await sqlConfig`
          UPDATE "usuarios" SET
            "telefono"         = ${config.telefono},
            "avatar"           = ${config.avatar},
            "instagram"        = ${config.instagram},
            "twitter"          = ${config.twitter},
            "linkedin"         = ${config.linkedin},
            "facebook"         = ${config.facebook},
            "perfil_publico"   = ${config.perfil_publico},
            "mostrar_contacto" = ${config.mostrar_contacto},
            "moneda"           = ${config.moneda}
          WHERE "id_usuario" = ${usuarioId}
          RETURNING "nombre", "email", "telefono", "avatar", "instagram", "twitter",
                    "linkedin", "facebook", "perfil_publico", "mostrar_contacto", "moneda"
        `;

    if (emailFinal) {
      await sqlIdentidad`
        UPDATE "usuarios" SET "email" = ${emailFinal} WHERE "id_usuario" = ${usuarioId}
      `;
    }

    if (!updated || updated.length === 0) {
      return respuestaError('Usuario no encontrado', 404);
    }

    const u = updated[0];

    return new Response(JSON.stringify({
      success: true,
      message: 'Configuración guardada',
      perfil: { nombre: u.nombre, email: u.email },
      config: {
        telefono: u.telefono ?? '',
        avatar: u.avatar ?? '',
        instagram: u.instagram ?? '',
        twitter: u.twitter ?? '',
        linkedin: u.linkedin ?? '',
        facebook: u.facebook ?? '',
        perfil_publico: u.perfil_publico ?? true,
        mostrar_contacto: u.mostrar_contacto ?? true,
        moneda: u.moneda === 'ARS' ? 'ARS' : 'USD',
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error en ActualizarConfigUsuario:', error.message);
    return respuestaError('Error al guardar la configuración', 500);
  }
}
