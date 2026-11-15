
export const prerender = false;

import sql from '../../Backend/carga.js';
import { resolverUsuarioId } from '../../Backend/sesion.js';

import {
  asegurarEsquemaAlertas,
  jsonResponse,
  normalizarFiltros
} from '../../Backend/alertas.js';

const uuidValido = valor =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    .test(String(valor || ''));

export async function GET({ request }) {
  try {
    const usuarioId = resolverUsuarioId(request);

    if (!usuarioId) {
      return jsonResponse({ error: 'Sesión no válida' }, 401);
    }

    await asegurarEsquemaAlertas();

    const alertas = await sql`
      SELECT *
      FROM alertas_busqueda
      WHERE id_usuario = ${usuarioId}
      ORDER BY creada_en DESC
    `;

    return jsonResponse({
      success: true,
      alertas
    });

  } catch (error) {
    console.error('[GestionarAlertas GET]', error);
    return jsonResponse({
      error: 'No se pudieron obtener las alertas'
    }, 500);
  }
}

export async function POST({ request }) {
  try {
    const usuarioId = resolverUsuarioId(request);

    if (!usuarioId) {
      return jsonResponse({ error: 'Sesión no válida' }, 401);
    }

    await asegurarEsquemaAlertas();

    const body = await request.json();

    let filtros;

    try {
      filtros = normalizarFiltros(body);
    } catch (error) {
      return jsonResponse({ error: error.message }, 400);
    }

    const existentes = await sql`
      SELECT COUNT(*)::int AS total
      FROM alertas_busqueda
      WHERE id_usuario = ${usuarioId}
    `;

    if (existentes[0].total >= 20) {
      return jsonResponse({
        error: 'Alcanzaste el límite de 20 búsquedas guardadas.'
      }, 409);
    }

    const [alerta] = await sql`
      INSERT INTO alertas_busqueda (
        id_usuario,
        nombre,
        barrio,
        tipo_propiedad,
        precio_min_usd,
        precio_max_usd,
        superficie_min_m2,
        superficie_max_m2,
        ambientes_min,
        ambientes_max
      )
      VALUES (
        ${usuarioId},
        ${filtros.nombre},
        ${filtros.barrio},
        ${filtros.tipo_propiedad},
        ${filtros.precio_min_usd},
        ${filtros.precio_max_usd},
        ${filtros.superficie_min_m2},
        ${filtros.superficie_max_m2},
        ${filtros.ambientes_min},
        ${filtros.ambientes_max}
      )
      RETURNING *
    `;

    return jsonResponse({
      success: true,
      alerta
    }, 201);

  } catch (error) {
    console.error('[GestionarAlertas POST]', error);
    return jsonResponse({
      error: 'No se pudo crear la alerta'
    }, 500);
  }
}

export async function PATCH({ request }) {
  try {
    const usuarioId = resolverUsuarioId(request);

    if (!usuarioId) {
      return jsonResponse({ error: 'Sesión no válida' }, 401);
    }

    await asegurarEsquemaAlertas();

    const body = await request.json();
    const id = String(body.id_alerta || '');

    if (!uuidValido(id) || typeof body.activa !== 'boolean') {
      return jsonResponse({
        error: 'Datos de actualización inválidos'
      }, 400);
    }

    const resultado = await sql`
      UPDATE alertas_busqueda
      SET activa = ${body.activa},
          actualizada_en = NOW()
      WHERE id_alerta = ${id}
        AND id_usuario = ${usuarioId}
      RETURNING id_alerta, activa
    `;

    if (!resultado.length) {
      return jsonResponse({ error: 'Alerta no encontrada' }, 404);
    }

    return jsonResponse({
      success: true,
      alerta: resultado[0]
    });

  } catch (error) {
    console.error('[GestionarAlertas PATCH]', error);
    return jsonResponse({
      error: 'No se pudo actualizar la alerta'
    }, 500);
  }
}

export async function DELETE({ request }) {
  try {
    const usuarioId = resolverUsuarioId(request);

    if (!usuarioId) {
      return jsonResponse({ error: 'Sesión no válida' }, 401);
    }

    await asegurarEsquemaAlertas();

    const body = await request.json();
    const id = String(body.id_alerta || '');

    if (!uuidValido(id)) {
      return jsonResponse({
        error: 'Identificador inválido'
      }, 400);
    }

    const resultado = await sql`
      DELETE FROM alertas_busqueda
      WHERE id_alerta = ${id}
        AND id_usuario = ${usuarioId}
      RETURNING id_alerta
    `;

    if (!resultado.length) {
      return jsonResponse({ error: 'Alerta no encontrada' }, 404);
    }

    return jsonResponse({ success: true });

  } catch (error) {
    console.error('[GestionarAlertas DELETE]', error);
    return jsonResponse({
      error: 'No se pudo eliminar la alerta'
    }, 500);
  }
}
