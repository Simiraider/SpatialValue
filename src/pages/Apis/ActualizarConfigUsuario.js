export const prerender = false;
import sqlConfig, { asegurarEsquemaConfig } from '../../Backend/carga-config.js';
import sqlIdentidad from '../../Backend/carga.js';
import crypto from 'node:crypto';

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
    typeof v.sitio_web === 'string' &&
    typeof v.instagram_publico === 'boolean' &&
    typeof v.twitter_publico === 'boolean' &&
    typeof v.linkedin_publico === 'boolean' &&
    typeof v.facebook_publico === 'boolean' &&
    typeof v.sitio_publico === 'boolean' &&
    typeof v.perfil_publico === 'boolean' &&
    typeof v.mostrar_contacto === 'boolean' &&
    typeof v.visibilidad_estadisticas === 'boolean' &&
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

const TELEFONO_RE = /^\+?[0-9\s()-]{7,20}$/;
const CODIGO_RE = /^\d{6}$/;

function generarCodigoVerificacion() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

async function hashCodigo(codigo) {
  const argon2 = (await import('argon2')).default;
  return argon2.hash(codigo, { type: argon2.argon2id, parallelism: 1, timeCost: 2, memoryCost: 16384 });
}

async function enviarEmailVerificacion(destino, codigo) {
  const host = import.meta.env.SMTP_HOST || process.env.SMTP_HOST;
  const port = Number(import.meta.env.SMTP_PORT || process.env.SMTP_PORT || 587);
  const user = import.meta.env.SMTP_USER || process.env.SMTP_USER;
  const pass = import.meta.env.SMTP_PASS || process.env.SMTP_PASS;
  const from = import.meta.env.SMTP_FROM || process.env.SMTP_FROM || `Spatial Value <${user}>`;

  if (!host || !user || !pass) {
    console.warn('[verificacion] SMTP sin configurar: no se envió el email de verificación.');
    return false;
  }

  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  try {
    await transporter.sendMail({
      from,
      to: destino,
      subject: 'Tu código de verificación · Spatial Value',
      text:
        `Tu código de verificación es: ${codigo}\n\n` +
        'Vence en 15 minutos. Si no fuiste vos, ignorá este mensaje.',
    });
    return true;
  } catch (err) {
    console.error('[verificacion] Error enviando email:', err?.message || err);
    return false;
  }
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
    await asegurarEsquemaConfig();
    const usuarioId = getCookieUsuarioId(request);

    if (!usuarioId || usuarioId === 'undefined' || usuarioId === 'null') {
      return respuestaError('Sesión no válida', 401);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return respuestaError('Cuerpo de la petición inválido', 400);
    }

    const { config, passwordActual } = body;

    if (body.accion === 'desactivar_cuenta') {
      await sqlConfig`
        UPDATE "usuarios" SET "cuenta_activa" = false WHERE "id_usuario" = ${usuarioId}
      `;
      return new Response(
        JSON.stringify({ success: true, message: 'Cuenta desactivada' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (body.accion === 'eliminar_cuenta') {
      if (!passwordActual) {
        return respuestaError('Necesitás confirmar con tu contraseña actual', 400);
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
        return respuestaError('La contraseña es incorrecta', 403);
      }
      await sqlConfig`DELETE FROM "usuarios" WHERE "id_usuario" = ${usuarioId}`;
      await sqlIdentidad`DELETE FROM "usuarios" WHERE "id_usuario" = ${usuarioId}`;
      return new Response(
        JSON.stringify({ success: true, message: 'Cuenta eliminada' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (body.accion === 'solicitar_verificacion') {
      const canal = body.canal === 'telefono' ? 'telefono' : 'email';
      const destino = String(body.destino ?? '').trim();

      const estado = await sqlConfig`
        SELECT "email", "telefono", "email_verificado", "telefono_verificado"
        FROM "usuarios" WHERE "id_usuario" = ${usuarioId} LIMIT 1
      `;
      if (estado.length === 0) {
        return respuestaError('Usuario no encontrado', 404);
      }
      const fila = estado[0];

      if (canal === 'email') {
        if (!EMAIL_RE.test(destino)) {
          return respuestaError('Ingresá un email válido', 400);
        }
        if (fila.email_verificado && String(fila.email).toLowerCase() === destino.toLowerCase()) {
          return new Response(
            JSON.stringify({ success: true, ya_verificado: true }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
      } else {
        if (!TELEFONO_RE.test(destino)) {
          return respuestaError('Ingresá un teléfono válido', 400);
        }
        if (fila.telefono_verificado && String(fila.telefono).trim() === destino) {
          return new Response(
            JSON.stringify({ success: true, ya_verificado: true }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      if (canal === 'email' && fila.email_verificado) {
        return respuestaError('Guardá el cambio de email antes de verificar el nuevo.', 409);
      }
      if (canal === 'telefono' && fila.telefono_verificado) {
        return respuestaError('Guardá el cambio de teléfono antes de verificar el nuevo.', 409);
      }

      const recientes = await sqlConfig`
        SELECT COUNT(*)::int AS n FROM "verificaciones_contacto"
        WHERE "id_usuario" = ${usuarioId} AND "canal" = ${canal}
          AND "creado" > NOW() - INTERVAL '2 minutes'
      `;
      if ((recientes[0]?.n ?? 0) >= 1) {
        return respuestaError('Esperá un momento antes de pedir otro código', 429);
      }

      const codigo = generarCodigoVerificacion();
      const codigoHash = await hashCodigo(codigo);

      await sqlConfig`
        DELETE FROM "verificaciones_contacto"
        WHERE "id_usuario" = ${usuarioId} AND "canal" = ${canal}
      `;
      const insertadas = await sqlConfig`
        INSERT INTO "verificaciones_contacto" ("id_usuario", "canal", "codigo_hash", "destino", "expira")
        VALUES (${usuarioId}, ${canal}, ${codigoHash}, ${destino}, NOW() + INTERVAL '15 minutes')
        RETURNING "id"
      `;
      const verificacionId = insertadas[0].id;

      let enviado = false;
      if (canal === 'email') {
        enviado = await enviarEmailVerificacion(destino, codigo).catch(() => false);
      }

      if (!enviado) {
        await sqlConfig`DELETE FROM "verificaciones_contacto" WHERE "id" = ${verificacionId}`;
        if (import.meta.env.DEV) {
          return new Response(
            JSON.stringify({
              success: true,
              enviado: false,
              mensaje: 'El envío no está configurado en este entorno. Usá el código de desarrollo.',
              dev_code: codigo,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        const motivo = canal === 'email'
          ? 'No se pudo enviar el email de verificación. Probá de nuevo en unos minutos.'
          : 'El envío por SMS todavía no está disponible.';
        return respuestaError(motivo, 503);
      }

      return new Response(
        JSON.stringify({
          success: true,
          enviado: true,
          mensaje: `Te enviamos un código a ${destino}. Vence en 15 minutos.`,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (body.accion === 'verificar_contacto') {
      const canal = body.canal === 'telefono' ? 'telefono' : 'email';
      const destino = String(body.destino ?? '').trim();
      const codigo = String(body.codigo ?? '').trim();

      if (!CODIGO_RE.test(codigo)) {
        return respuestaError('El código tiene 6 números', 400);
      }

      const estado = await sqlConfig`
        SELECT "email", "telefono"
        FROM "usuarios" WHERE "id_usuario" = ${usuarioId} LIMIT 1
      `;
      if (estado.length === 0) {
        return respuestaError('Usuario no encontrado', 404);
      }
      const guardado = estado[0];
      if (canal === 'email' && String(guardado.email ?? '').toLowerCase() !== destino.toLowerCase()) {
        return respuestaError('Guardá el nuevo email antes de verificarlo.', 409);
      }
      if (canal === 'telefono' && String(guardado.telefono ?? '').trim() !== destino) {
        return respuestaError('Guardá el nuevo teléfono antes de verificarlo.', 409);
      }

      const filas = await sqlConfig`
        SELECT "id", "codigo_hash", "destino", "intentos", "expira"
        FROM "verificaciones_contacto"
        WHERE "id_usuario" = ${usuarioId} AND "canal" = ${canal}
        ORDER BY "creado" DESC
        LIMIT 1
      `;
      if (filas.length === 0) {
        return respuestaError('No hay un código activo. Pedí uno nuevo.', 400);
      }
      const v = filas[0];

      if (v.destino !== destino) {
        return respuestaError('El código no corresponde a este contacto', 400);
      }
      if (new Date(v.expira).getTime() < Date.now()) {
        await sqlConfig`DELETE FROM "verificaciones_contacto" WHERE "id" = ${v.id}`;
        return respuestaError('El código venció. Pedí uno nuevo.', 400);
      }
      if ((v.intentos ?? 0) >= 5) {
        await sqlConfig`DELETE FROM "verificaciones_contacto" WHERE "id" = ${v.id}`;
        return respuestaError('Demasiados intentos. Pedí un código nuevo.', 429);
      }

      const argon2 = (await import('argon2')).default;
      const coincide = await argon2.verify(v.codigo_hash, codigo).catch(() => false);
      if (!coincide) {
        await sqlConfig`UPDATE "verificaciones_contacto" SET "intentos" = "intentos" + 1 WHERE "id" = ${v.id}`;
        return respuestaError('Código incorrecto', 400);
      }

      await sqlConfig`DELETE FROM "verificaciones_contacto" WHERE "id" = ${v.id}`;
      if (canal === 'email') {
        await sqlConfig`UPDATE "usuarios" SET "email_verificado" = true WHERE "id_usuario" = ${usuarioId}`;
      } else {
        await sqlConfig`UPDATE "usuarios" SET "telefono_verificado" = true WHERE "id_usuario" = ${usuarioId}`;
      }

      return new Response(
        JSON.stringify({ success: true, message: canal === 'email' ? 'Email verificado' : 'Teléfono verificado' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

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
            "telefono"                 = ${config.telefono},
            "avatar"                   = ${config.avatar},
            "instagram"                = ${config.instagram},
            "twitter"                  = ${config.twitter},
            "linkedin"                 = ${config.linkedin},
            "facebook"                 = ${config.facebook},
            "sitio_web"                = ${config.sitio_web},
            "instagram_publico"        = ${config.instagram_publico},
            "twitter_publico"          = ${config.twitter_publico},
            "linkedin_publico"         = ${config.linkedin_publico},
            "facebook_publico"         = ${config.facebook_publico},
            "sitio_publico"            = ${config.sitio_publico},
            "perfil_publico"           = ${config.perfil_publico},
            "mostrar_contacto"         = ${config.mostrar_contacto},
            "visibilidad_estadisticas" = ${config.visibilidad_estadisticas},
            "moneda"                   = ${config.moneda},
            "email"                    = ${emailFinal},
            "email_verificado"         = CASE WHEN "email" <> ${emailFinal} THEN false ELSE "email_verificado" END,
            "telefono_verificado"      = CASE WHEN "telefono" <> ${config.telefono} THEN false ELSE "telefono_verificado" END
          WHERE "id_usuario" = ${usuarioId}
          RETURNING "nombre", "email", "telefono", "avatar", "instagram", "twitter",
                    "linkedin", "facebook", "sitio_web", "instagram_publico", "twitter_publico",
                    "linkedin_publico", "facebook_publico", "sitio_publico", "perfil_publico",
                    "mostrar_contacto", "visibilidad_estadisticas", "moneda",
                    "email_verificado", "telefono_verificado"
        `
      : await sqlConfig`
          UPDATE "usuarios" SET
            "telefono"                 = ${config.telefono},
            "avatar"                   = ${config.avatar},
            "instagram"                = ${config.instagram},
            "twitter"                  = ${config.twitter},
            "linkedin"                 = ${config.linkedin},
            "facebook"                 = ${config.facebook},
            "sitio_web"                = ${config.sitio_web},
            "instagram_publico"        = ${config.instagram_publico},
            "twitter_publico"          = ${config.twitter_publico},
            "linkedin_publico"         = ${config.linkedin_publico},
            "facebook_publico"         = ${config.facebook_publico},
            "sitio_publico"            = ${config.sitio_publico},
            "perfil_publico"           = ${config.perfil_publico},
            "mostrar_contacto"         = ${config.mostrar_contacto},
            "visibilidad_estadisticas" = ${config.visibilidad_estadisticas},
            "moneda"                   = ${config.moneda},
            "telefono_verificado"      = CASE WHEN "telefono" <> ${config.telefono} THEN false ELSE "telefono_verificado" END
          WHERE "id_usuario" = ${usuarioId}
          RETURNING "nombre", "email", "telefono", "avatar", "instagram", "twitter",
                    "linkedin", "facebook", "sitio_web", "instagram_publico", "twitter_publico",
                    "linkedin_publico", "facebook_publico", "sitio_publico", "perfil_publico",
                    "mostrar_contacto", "visibilidad_estadisticas", "moneda",
                    "email_verificado", "telefono_verificado"
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
        sitio_web: u.sitio_web ?? '',
        instagram_publico: u.instagram_publico ?? true,
        twitter_publico: u.twitter_publico ?? true,
        linkedin_publico: u.linkedin_publico ?? true,
        facebook_publico: u.facebook_publico ?? true,
        sitio_publico: u.sitio_publico ?? true,
        perfil_publico: u.perfil_publico ?? true,
        mostrar_contacto: u.mostrar_contacto ?? true,
        visibilidad_estadisticas: u.visibilidad_estadisticas ?? true,
        moneda: u.moneda === 'ARS' ? 'ARS' : 'USD',
        email_verificado: u.email_verificado ?? false,
        telefono_verificado: u.telefono_verificado ?? false,
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
