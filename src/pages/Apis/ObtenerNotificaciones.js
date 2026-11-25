export const prerender = false;
import sqlConfig, { asegurarEsquemaConfig } from '../../Backend/carga-config.js';
import sqlIdentidad from '../../Backend/carga.js';
import { asegurarEsquemaAlertas } from '../../Backend/alertas.js';
import { resolverUsuarioId, ipDePeticion, esMismoOrigen } from '../../Backend/sesion.js';
import { permitirFrecuencia } from '../../Backend/limite.js';

function getCookieUsuarioId(request) {
  return resolverUsuarioId(request);
}

function respuestaError(mensaje, status) {
  return new Response(JSON.stringify({ error: mensaje }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET({ request }) {
  try {
    await Promise.all([asegurarEsquemaConfig(), asegurarEsquemaAlertas()]);

    const usuarioId = getCookieUsuarioId(request);
    if (!usuarioId) {
      return respuestaError('Sesión no válida', 401);
    }

    const [soloMios, alertasProps] = await Promise.all([
      sqlConfig`
        SELECT "id", "fecha", "id_emisor" FROM "usuario_likes"
        WHERE "id_receptor" = ${usuarioId}
        ORDER BY "fecha" DESC
        LIMIT 20
      `,
      sqlIdentidad`
        SELECT
          id_notificacion,
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
      `,
    ]);

    let notificacionesLikes = [];

    if (soloMios.length > 0) {
      const emisores = soloMios.map((l) => l.id_emisor);

      const [identificadores, avatares, ultimaMarca] = await Promise.all([
        sqlIdentidad`
          SELECT "id_usuario", "nombre" FROM "usuarios"
          WHERE "id_usuario" = ANY(${emisores}::uuid[])
        `,
        sqlConfig`
          SELECT "id_usuario", "avatar", "perfil_publico" FROM "usuarios"
          WHERE "id_usuario" = ANY(${emisores}::uuid[])
        `,
        sqlConfig`
          SELECT "visto_hasta" FROM "usuario_notificaciones_meta"
          WHERE "id_usuario" = ${usuarioId} LIMIT 1
        `,
      ]);

      const nombres = new Map(identificadores.map((i) => [String(i.id_usuario), i.nombre]));
      const avatarPorId = new Map(avatares.map((a) => [String(a.id_usuario), a]));
      const vistoHasta = ultimaMarca[0]?.visto_hasta ? new Date(ultimaMarca[0].visto_hasta) : null;

      notificacionesLikes = soloMios.map((l) => {
        const pub = avatarPorId.get(String(l.id_emisor));
        const esPublico = pub ? pub.perfil_publico !== false : true;
        return {
          tipo: 'like',
          id: `like-${l.id}`,
          emisor_id: String(l.id_emisor),
          emisor_nombre: nombres.get(String(l.id_emisor)) || 'Usuario',
          emisor_avatar: esPublico ? (pub?.avatar || '') : '',
          fecha: l.fecha,
          no_visto: !vistoHasta || new Date(l.fecha) > vistoHasta,
        };
      });
    }

    const notificacionesPropiedades = alertasProps.map((a) => ({
      tipo: 'propiedad',
      id: `prop-${a.id_notificacion}`,
      titulo: a.titulo,
      barrio: a.barrio,
      precio_usd: a.precio_usd,
      superficie_m2: a.superficie_m2,
      ambientes: a.ambientes,
      url: a.url,
      fecha: a.creada_en,
      no_visto: !a.vista,
    }));

    const notificaciones = [...notificacionesLikes, ...notificacionesPropiedades]
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
      .slice(0, 40);

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
    await Promise.all([asegurarEsquemaConfig(), asegurarEsquemaAlertas()]);

    if (!esMismoOrigen(request)) {
      return respuestaError('Origen no permitido.', 403);
    }

    if (!(await permitirFrecuencia(`notificaciones:${ipDePeticion(request)}`, 60, 60_000))) {
      return respuestaError('Demasiadas acciones. Esperá un momento.', 429);
    }

    const usuarioId = getCookieUsuarioId(request);
    if (!usuarioId) {
      return respuestaError('Sesión no válida', 401);
    }

    await Promise.all([
      sqlConfig`
        INSERT INTO "usuario_notificaciones_meta" ("id_usuario", "visto_hasta")
        VALUES (${usuarioId}, NOW())
        ON CONFLICT ("id_usuario") DO UPDATE SET "visto_hasta" = NOW()
      `,
      sqlIdentidad`
        UPDATE alertas_notificaciones
        SET vista = TRUE
        WHERE id_usuario = ${usuarioId}
          AND vista = FALSE
      `,
    ]);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error al marcar notificaciones:', error.message);
    return respuestaError('Error al marcar notificaciones', 500);
  }
}