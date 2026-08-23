export const prerender = false;
import sql from '../../Backend/carga.js';

export async function GET({ url }) {
  try {
    const id = url.searchParams.get('id');
    const usuarioId = url.searchParams.get('usuario_id');
    const barrio = url.searchParams.get('barrio');
    const superficie = Number(url.searchParams.get('superficie')) || 0;
    const tipoOperacion = url.searchParams.get('tipo_operacion') || 'venta';

    if (!usuarioId) {
      return new Response(
        JSON.stringify({ error: "Falta el usuario" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const supMin = superficie > 0 ? superficie * 0.6 : 0;
    const supMax = superficie > 0 ? superficie * 1.4 : 99999;

    let comparables;
    if (barrio) {
      comparables = await sql`
        SELECT id_publicacion, titulo, direccion, barrio, tipo_propiedad,
               superficie_total, superficie_cubierta, precio, precio_estimado_ia,
               ambientes, dormitorios, banos, tipo_operacion
        FROM publicaciones
        WHERE id_usuario = ${usuarioId}
          AND id_publicacion::text != ${id || '__none__'}
          AND tipo_operacion = ${tipoOperacion}
          AND LOWER(barrio) = LOWER(${barrio})
          AND COALESCE(superficie_cubierta, 0) BETWEEN ${supMin} AND ${supMax}
        ORDER BY ABS(COALESCE(superficie_cubierta, 0) - ${superficie}) ASC
        LIMIT 10
      `;
    } else {
      comparables = await sql`
        SELECT id_publicacion, titulo, direccion, barrio, tipo_propiedad,
               superficie_total, superficie_cubierta, precio, precio_estimado_ia,
               ambientes, dormitorios, banos, tipo_operacion
        FROM publicaciones
        WHERE id_usuario = ${usuarioId}
          AND id_publicacion::text != ${id || '__none__'}
          AND tipo_operacion = ${tipoOperacion}
          AND COALESCE(superficie_cubierta, 0) BETWEEN ${supMin} AND ${supMax}
        ORDER BY ABS(COALESCE(superficie_cubierta, 0) - ${superficie}) ASC
        LIMIT 10
      `;
    }

    return new Response(JSON.stringify(comparables), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error al obtener comparables:", error.message);
    return new Response(
      JSON.stringify({ error: "Error al cargar comparables" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
