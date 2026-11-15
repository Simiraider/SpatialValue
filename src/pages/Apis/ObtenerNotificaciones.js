
export const prerender = false;

import sqlConfig, {
  asegurarEsquemaConfig
} from '../../Backend/carga-config.js';

import sql from '../../Backend/carga.js';

import { resolverUsuarioId } from '../../Backend/sesion.js';

import {
  asegurarEsquemaAlertas,
  jsonResponse
} from '../../Backend/alertas.js';

export async function GET({ request }) {
  try {
    const usuarioId = resolverUsuarioId(request);

    if (!usuarioId) {
      return jsonResponse({ error: 'Sesión no válida' }, 401);
    }

    await asegurarEsquemaConfig();
    await asegurarEsquemaAlertas();

    // Notificaciones de amigos
    const likes = await sqlConfig`
      SELECT fecha, id_emisor
      FROM usuario_likes
      WHERE id_receptor = ${usuarioId}
      ORDER BY fecha DESC
      LIMIT 20
    `;

    let likesFormateados = [];

    if (likes.length) {
      const emisores = likes.map(l => l.id_emisor);

      const [usuarios, perfiles, meta] = await Promise.all([
        sql`
          SELECT id_usuario, nombre
          FROM usuarios
          WHERE id_usuario = ANY(${emisores}::uuid[])
        `,

        sqlConfig`
          SELECT id_usuario, avatar, perfil_publico
          FROM usuarios
          WHERE id_usuario = ANY(${emisores}::uuid[])
        `,

        sqlConfig`
          SELECT visto_hasta
          FROM usuario_notificaciones_meta
          WHERE id_usuario = ${usuarioId}
          LIMIT 1
        `
      ]);

      const nombres = new Map(
        usuarios.map(u => [String(u.id_usuario), u.nombre])
      );

      const avatares = new Map(
        perfiles.map(u => [String(u.id_usuario), u])
      );

      const vistoHasta = meta[0]?.visto_hasta
        ? new Date(meta[0].visto_hasta)
        : null;

      likesFormateados = likes.map(l => {
        const perfil = avatares.get(String(l.id_emisor));

        return {
          tipo: 'like',
          id: `like-${l.id_emisor}-${new Date(l.fecha).getTime()}`,
          emisor_id: String(l.id_emisor),
          emisor_nombre: nombres.get(String(l.id_emisor)) || 'Usuario',
          emisor_avatar:
            perfil && perfil.perfil_publico !== false
              ? perfil.avatar || ''
              : '',
          fecha: l.fecha,
          no_visto:
            !vistoHasta || new Date(l.fecha) > vistoHasta
        };
      });
    }

    // Notificaciones inmobiliarias
    const alertas = await sql`
      SELECT
        id_notificacion,
        id_propiedad,
        titulo,
        barrio,
        tipo_propiedad,
        precio_usd,
        superficie_m2,
        ambientes,
        url,
        creada_en,
        vista
      FROM alertas_notificaciones
      WHERE id_usuario = ${usuarioId}
      ORDER BY creada_en DESC
      LIMIT 30
    `;

    const alertasFormateadas = alertas.map(n => ({
      tipo: 'propiedad',
      id: String(n.id_notificacion),
      id_propiedad: n.id_propiedad,
      titulo: n.titulo,
      barrio: n.barrio,
      tipo_propiedad: n.tipo_propiedad,
      precio_usd: n.precio_usd,
      superficie_m2: n.superficie_m2,
      ambientes: n.ambientes,
      url: n.url,
      fecha: n.creada_en,
      no_visto: !n.vista
    }));

    const notificaciones = [
      ...likesFormateados,
      ...alertasFormateadas
    ].sort(
      (a, b) =>
        new Date(b.fecha).getTime() -
        new Date(a.fecha).getTime()
    );

    return jsonResponse({
      success: true,
      no_vistos: notificaciones.filter(n => n.no_visto).length,
      notificaciones
    });

  } catch (error) {
    console.error('[ObtenerNotificaciones GET]', error);

    return jsonResponse({
      error: 'Error al cargar notificaciones'
    }, 500);
  }
}

export async function POST({ request }) {
  try {
    const usuarioId = resolverUsuarioId(request);

    if (!usuarioId) {
      return jsonResponse({ error: 'Sesión no válida' }, 401);
    }

    await asegurarEsquemaConfig();
    await asegurarEsquemaAlertas();

    await Promise.all([
      sqlConfig`
        INSERT INTO usuario_notificaciones_meta (
          id_usuario,
          visto_hasta
        )
        VALUES (${usuarioId}, NOW())
        ON CONFLICT (id_usuario)
        DO UPDATE SET visto_hasta = NOW()
      `,

      sql`
        UPDATE alertas_notificaciones
        SET vista = TRUE
        WHERE id_usuario = ${usuarioId}
          AND vista = FALSE
      `
    ]);

    return jsonResponse({ success: true });

  } catch (error) {
    console.error('[ObtenerNotificaciones POST]', error);

    return jsonResponse({
      error: 'Error al marcar notificaciones'
    }, 500);
  }
}
