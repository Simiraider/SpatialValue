export const prerender = false;
import sqlIdentidad from '../../Backend/carga.js';
import sqlConfig, { asegurarEsquemaConfig } from '../../Backend/carga-config.js';
import { resolverUsuarioId, permitirFrecuencia, ipDePeticion } from '../../Backend/sesion.js';

const escaparLike = (v) => v.replace(/([\\%_])/g, '\\$1');

export async function GET({ url, request }) {
  try {
    await asegurarEsquemaConfig();

    if (!permitirFrecuencia(`buscar:${ipDePeticion(request)}`, 30)) {
      return new Response(
        JSON.stringify({ error: 'Demasiadas búsquedas. Esperá un momento.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const usuarioActual = resolverUsuarioId(request);
    if (!usuarioActual) {
      return new Response(
        JSON.stringify({ error: 'No has iniciado sesión' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const query = (url.searchParams.get('q') || '').trim().slice(0, 50);

    if (query.length < 2) {
      return new Response(JSON.stringify({ success: true, resultados: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const patron = `%${escaparLike(query)}%`;

    const usuarios = await sqlIdentidad`
      SELECT "id_usuario", "nombre"
      FROM "usuarios"
      WHERE "nombre" ILIKE ${patron}
        AND "id_usuario"::text != ${usuarioActual}
      ORDER BY "nombre" ASC
      LIMIT 10
    `;

    if (usuarios.length === 0) {
      return new Response(JSON.stringify({ success: true, resultados: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const ids = usuarios.map((u) => u.id_usuario);

    const configRows = await sqlConfig`
      SELECT "id_usuario", "avatar", "instagram", "twitter", "linkedin", "facebook",
             "sitio_web", "instagram_publico", "twitter_publico", "linkedin_publico",
             "facebook_publico", "sitio_publico", "perfil_publico", "mostrar_contacto",
             "visibilidad_estadisticas"
      FROM "usuarios"
      WHERE "id_usuario" = ANY(${ids}::uuid[])
    `;

    const configPorId = new Map(configRows.map((c) => [String(c.id_usuario), c]));

    const misLikes = await sqlConfig`
      SELECT "id_receptor" FROM "usuario_likes" WHERE "id_emisor" = ${usuarioActual}
    `;
    const yaLesDiLike = new Set(misLikes.map((l) => String(l.id_receptor)));

    const resultados = usuarios.map((u) => {
      const c = configPorId.get(String(u.id_usuario));
      const esPublico = c ? c.perfil_publico !== false : true;

      return {
        id: String(u.id_usuario),
        nombre: u.nombre,
        avatar: esPublico ? (c?.avatar || '') : '',
        instagram: esPublico && c?.instagram_publico !== false ? (c?.instagram || '') : '',
        twitter: esPublico && c?.twitter_publico !== false ? (c?.twitter || '') : '',
        linkedin: esPublico && c?.linkedin_publico !== false ? (c?.linkedin || '') : '',
        facebook: esPublico && c?.facebook_publico !== false ? (c?.facebook || '') : '',
        sitio_web: esPublico && c?.sitio_publico !== false ? (c?.sitio_web || '') : '',
        perfil_publico: esPublico,
        mostrar_contacto: esPublico && c ? c.mostrar_contacto !== false : false,
        liked_por_mi: yaLesDiLike.has(String(u.id_usuario)),
      };
    });

    return new Response(JSON.stringify({ success: true, resultados }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error en BuscarUsuarios:', error.message);
    return new Response(
      JSON.stringify({ error: 'Error al buscar usuarios' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
