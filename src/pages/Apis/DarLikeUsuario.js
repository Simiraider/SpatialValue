export const prerender = false;
import sqlConfig from '../../Backend/carga-config.js';
import sqlIdentidad from '../../Backend/carga.js';

function getCookieUsuarioId(request) {
  const cookies = request.headers.get('cookie') || '';
  const m = cookies.match(/(?:^|;\s*)usuario_id=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST({ request }) {
  try {
    const emisor = getCookieUsuarioId(request);
    if (!emisor || !UUID_RE.test(emisor)) {
      return new Response(
        JSON.stringify({ error: 'Sesión no válida' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json().catch(() => null);
    const receptor = String(body?.id_receptor || body?.id || '');

    if (!receptor || !UUID_RE.test(receptor)) {
      return new Response(
        JSON.stringify({ error: 'Usuario objetivo inválido' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (emisor === receptor) {
      return new Response(
        JSON.stringify({ error: 'No podés darte like a vos mismo' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const receptorExiste = await sqlIdentidad`
      SELECT "id_usuario" FROM "usuarios" WHERE "id_usuario" = ${receptor} LIMIT 1
    `;
    if (receptorExiste.length === 0) {
      return new Response(
        JSON.stringify({ error: 'El usuario no existe' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const existente = await sqlConfig`
      SELECT "id" FROM "usuario_likes"
      WHERE "id_emisor" = ${emisor} AND "id_receptor" = ${receptor}
      LIMIT 1
    `;

    let liked;
    if (existente.length > 0) {
      await sqlConfig`
        DELETE FROM "usuario_likes"
        WHERE "id_emisor" = ${emisor} AND "id_receptor" = ${receptor}
      `;
      liked = false;
    } else {
      await sqlConfig`
        INSERT INTO "usuario_likes" ("id_emisor", "id_receptor")
        VALUES (${emisor}, ${receptor})
        ON CONFLICT ("id_emisor", "id_receptor") DO NOTHING
      `;
      liked = true;
    }

    const total = await sqlConfig`
      SELECT COUNT(*)::int AS total FROM "usuario_likes" WHERE "id_receptor" = ${receptor}
    `;

    return new Response(JSON.stringify({ success: true, liked, total_likes: total[0].total }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error en DarLikeUsuario:', error.message);
    return new Response(
      JSON.stringify({ error: 'Error al procesar el like' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
