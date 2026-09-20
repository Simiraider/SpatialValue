export const prerender = false;
import sqlConfig from '../../Backend/carga-config.js';
import sqlIdentidad from '../../Backend/carga.js';

function getCookieUsuarioId(request) {
  const cookies = request.headers.get('cookie') || '';
  const m = cookies.match(/(?:^|;\s*)usuario_id=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

const CAMPOS_CONFIG = `"nombre", "email", "telefono", "avatar", "instagram", "twitter",
       "linkedin", "facebook", "perfil_publico", "mostrar_contacto", "moneda"`;

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

export async function GET({ request, url }) {
  try {
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

    await asegurarUsuarioEnConfig(usuarioId);

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
        perfil_publico: u.perfil_publico ?? true,
        mostrar_contacto: u.mostrar_contacto ?? true,
        moneda: u.moneda === 'ARS' ? 'ARS' : 'USD',
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
