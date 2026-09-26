export const prerender = false;
import sqlConfig, { asegurarEsquemaConfig } from '../../Backend/carga-config.js';
import sqlIdentidad from '../../Backend/carga.js';

function getCookieUsuarioId(request) {
  const cookies = request.headers.get('cookie') || '';
  const m = cookies.match(/(?:^|;\s*)usuario_id=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

const CAMPOS_CONFIG = `"nombre", "email", "telefono", "avatar", "instagram", "twitter",
       "linkedin", "facebook", "sitio_web", "instagram_publico", "twitter_publico",
       "linkedin_publico", "facebook_publico", "sitio_publico", "perfil_publico",
       "mostrar_contacto", "visibilidad_estadisticas", "moneda",
       "email_verificado", "telefono_verificado"`;

async function asegurarUsuarioEnConfig(usuarioId) {
  const existente = await sqlConfig`
    SELECT "id_usuario" FROM "usuarios" WHERE "id_usuario" = ${usuarioId} LIMIT 1
  `;
  if (existente.length > 0) return true;

  const identidad = await sqlIdentidad`
    SELECT "nombre", "email" FROM "usuarios" WHERE "id_usuario" = ${usuarioId} LIMIT 1
  `;
  if (identidad.length === 0) {
    return false;
  }

  await sqlConfig`
    INSERT INTO "usuarios" ("id_usuario", "nombre", "email", "contraseña")
    VALUES (${usuarioId}, ${identidad[0].nombre}, ${identidad[0].email}, '')
    ON CONFLICT ("id_usuario") DO NOTHING
  `;
  return true;
}

export async function GET({ request, url }) {
  try {
    await asegurarEsquemaConfig();
    const usuarioId = getCookieUsuarioId(request) || url.searchParams.get('usuario_id');

    const esValido = usuarioId &&
      usuarioId !== 'undefined' &&
      usuarioId !== 'null' &&
      usuarioId.trim() !== '';

    if (!esValido) {
      return new Response(
        JSON.stringify({ error: 'Sesión no válida' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const identidadOk = await asegurarUsuarioEnConfig(usuarioId);
    if (!identidadOk) {
      return new Response(
        JSON.stringify({ error: 'Sesión no válida', sesion_expirada: true }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const rows = await sqlConfig`
      SELECT ${sqlConfig.unsafe(CAMPOS_CONFIG)}
      FROM "usuarios"
      WHERE "id_usuario" = ${usuarioId}
      LIMIT 1
    `;

    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Usuario no encontrado' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const u = rows[0];

    return new Response(JSON.stringify({
      success: true,
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
    console.error('Error en ObtenerConfigUsuario:', error.message);
    return new Response(
      JSON.stringify({ error: 'Error al obtener la configuración' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
