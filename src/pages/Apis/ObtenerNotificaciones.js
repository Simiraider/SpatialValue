export const prerender = false;
import sqlConfig from '../../Backend/carga-config.js';
import sqlIdentidad from '../../Backend/carga.js';

function getCookieUsuarioId(request) {
  const cookies = request.headers.get('cookie') || '';
  const m = cookies.match(/(?:^|;\s*)usuario_id=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function respuestaError(mensaje, status) {
  return new Response(JSON.stringify({ error: mensaje }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET({ request }) {
  try {
    const usuarioId = getCookieUsuarioId(request);
    if (!usuarioId) {
      return respuestaError('Sesión no válida', 401);
    }

    const soloMios = await sqlConfig`
      SELECT "fecha", "id_emisor" FROM "usuario_likes"
      WHERE "id_receptor" = ${usuarioId}
      ORDER BY "fecha" DESC
      LIMIT 20
    `;

    if (soloMios.length === 0) {
      return new Response(
        JSON.stringify({ success: true, no_vistos: 0, notificaciones: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const emisores = soloMios.map((l) => l.id_emisor);
    const identificadores = await sqlIdentidad`
      SELECT "id_usuario", "nombre" FROM "usuarios"
      WHERE "id_usuario" = ANY(${emisores}::uuid[])
    `;
    const nombres = new Map(identificadores.map((i) => [String(i.id_usuario), i.nombre]));

    const avatares = await sqlConfig`
      SELECT "id_usuario", "avatar", "perfil_publico" FROM "usuarios"
      WHERE "id_usuario" = ANY(${emisores}::uuid[])
    `;
    const avatarPorId = new Map(avatares.map((a) => [String(a.id_usuario), a]));

    const ultimaMarca = await sqlConfig`
      SELECT "visto_hasta" FROM "usuario_notificaciones_meta"
      WHERE "id_usuario" = ${usuarioId} LIMIT 1
    `;
    const vistoHasta = ultimaMarca[0]?.visto_hasta ? new Date(ultimaMarca[0].visto_hasta) : null;

    const notificaciones = soloMios
      .map((l) => {
        const pub = avatarPorId.get(String(l.id_emisor));
        const esPublico = pub ? pub.perfil_publico !== false : true;
        return {
          emisor_id: String(l.id_emisor),
          emisor_nombre: nombres.get(String(l.id_emisor)) || 'Usuario',
          emisor_avatar: esPublico ? (pub?.avatar || '') : '',
          fecha: l.fecha,
          no_visto: !vistoHasta || new Date(l.fecha) > vistoHasta,
        };
      })
      .filter(Boolean);

    const noVistos = notificaciones.filter((n) => n.no_visto).length;

    return new Response(
      JSON.stringify({ success: true, no_vistos: noVistos, notificaciones }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error en ObtenerNotificaciones:', error.message);
    return respuestaError('Error al cargar notificaciones', 500);
  }
}

export async function POST({ request }) {
  try {
    const usuarioId = getCookieUsuarioId(request);
    if (!usuarioId) {
      return respuestaError('Sesión no válida', 401);
    }

    await sqlConfig`
      CREATE TABLE IF NOT EXISTS "usuario_notificaciones_meta" (
        "id_usuario"  uuid        PRIMARY KEY,
        "visto_hasta" timestamptz NOT NULL DEFAULT NOW()
      )
    `;

    await sqlConfig`
      INSERT INTO "usuario_notificaciones_meta" ("id_usuario", "visto_hasta")
      VALUES (${usuarioId}, NOW())
      ON CONFLICT ("id_usuario") DO UPDATE SET "visto_hasta" = NOW()
    `;

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error al marcar notificaciones:', error.message);
    return respuestaError('Error al marcar notificaciones', 500);
  }
}
