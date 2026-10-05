export const prerender = false;
import sql from '../../Backend/carga.js';
import { estimarPrecioVenta } from '../../lib/mercado';
import { resolverUsuarioId, permitirFrecuencia, ipDePeticion } from '../../Backend/sesion.js';

const numeroEnRango = (v, min, max, defecto) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return defecto;
  return Math.min(Math.max(Math.round(n), min), max);
};

const textoLimpio = (v, max) => String(v ?? '').trim().slice(0, max);

export async function POST({ request }) {
  try {
    if (!permitirFrecuencia(`actualizar-tasacion:${ipDePeticion(request)}`, 40, 3_600_000)) {
      return new Response(
        JSON.stringify({ error: "Demasiadas actualizaciones seguidas. Probá de nuevo más tarde." }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== 'object') {
      return new Response(
        JSON.stringify({ error: "Cuerpo de la petición inválido" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const idUsuarioFinal = resolverUsuarioId(request);
    if (!idUsuarioFinal) {
      return new Response(
        JSON.stringify({ error: "Sesión no válida. Volvé a iniciar sesión." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const id = textoLimpio(raw.id_publicacion ?? raw.id, 64);
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return new Response(
        JSON.stringify({ error: "ID de tasación inválido" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const existente = await sql`
      SELECT id_publicacion, tipo_operacion
      FROM publicaciones
      WHERE id_publicacion = ${id}::uuid AND id_usuario = ${idUsuarioFinal}
    `;
    if (existente.length === 0) {
      return new Response(
        JSON.stringify({ error: "No se encontró la tasación o no tienes permiso para modificarla" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const direccion = textoLimpio(raw.direccion, 200);
    if (!direccion) {
      return new Response(
        JSON.stringify({ error: "Falta la dirección" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const tipo_operacion = existente[0].tipo_operacion;
    const tipo_propiedad = String(raw.tipo_propiedad ?? 'Departamento') === 'Casa' ? 'Casa' : 'Departamento';
    const barrio = textoLimpio(raw.barrio, 100) || null;
    const comodidades = (Array.isArray(raw.comodidades) ? raw.comodidades : [])
      .slice(0, 30)
      .map((c) => String(c ?? '').trim())
      .filter((c) => c);

    const superficieCubierta = numeroEnRango(raw.superficie_cubierta, 1, 10000, 0);
    const superficieTotal = Math.max(numeroEnRango(raw.superficie_total, 1, 10000, superficieCubierta), superficieCubierta);
    const ambientes = numeroEnRango(raw.ambientes, 1, 50, 1);
    const dormitorios = numeroEnRango(raw.dormitorios, 0, 30, 0);
    const banos = numeroEnRango(raw.banos, 0, 30, 1);
    const expensas = numeroEnRango(raw.expensas, 0, 10_000_000, 0);
    const estadoGeneralRaw = Number(raw.estado_general ?? raw.estadoGeneral ?? 7);
    const estadoGeneral = Number.isFinite(estadoGeneralRaw) ? Math.min(Math.max(estadoGeneralRaw, 1), 10) : 7;
    const piso = raw.piso ? parseInt(String(raw.piso).replace(/[^0-9]/g, ''), 10) || null : null;
    const antiguedad = numeroEnRango(raw.antiguedad, 0, 200, 0) || null;
    const orientacion = textoLimpio(raw.orientacion, 30) || null;
    const disposicion = textoLimpio(raw.disposicion, 30) || null;
    const luzNatural = textoLimpio(raw.luz_natural ?? raw.luzNatural, 30) || null;
    const fotos = (Array.isArray(raw.fotos) ? raw.fotos : [])
      .slice(0, 12)
      .map((f) => ({
        name: textoLimpio(f?.name, 120),
        size: numeroEnRango(f?.size, 0, 20_000_000, 0),
        type: textoLimpio(f?.type, 50),
      }));

    const referenciaLocal = estimarPrecioVenta(
      superficieCubierta,
      Math.max(superficieTotal - superficieCubierta, 0),
      barrio || existente[0].ciudad || 'Buenos Aires'
    );

    const actualizar = await sql`
      UPDATE publicaciones SET
        titulo = ${`${tipo_propiedad} en ${direccion}`.slice(0, 200)},
        tipo_propiedad = ${tipo_propiedad.toLowerCase()},
        direccion = ${direccion},
        barrio = ${barrio},
        superficie_total = ${superficieTotal || null},
        superficie_cubierta = ${superficieCubierta || null},
        ambientes = ${ambientes},
        dormitorios = ${dormitorios},
        banos = ${banos},
        piso = ${piso},
        expensas = ${expensas},
        precio = ${referenciaLocal},
        precio_estimado_ia = NULL,
        fecha_actualizacion = NOW()
      WHERE id_publicacion = ${id}::uuid
      RETURNING id_publicacion;
    `;
    if (actualizar.length === 0) {
      return new Response(
        JSON.stringify({ error: "No se pudo actualizar la tasación" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      await sql`
        CREATE TABLE IF NOT EXISTS tasacion_detalles (
          id_publicacion TEXT PRIMARY KEY,
          datos JSONB NOT NULL DEFAULT '{}'::jsonb
        )
      `;
      try {
        await sql`ALTER TABLE tasacion_detalles ALTER COLUMN id_publicacion TYPE TEXT USING id_publicacion::text`;
      } catch (e) {}
      const detalles = JSON.stringify({
        antiguedad,
        orientacion,
        disposicion,
        luzNatural,
        estadoGeneral,
        comodidades,
        fotos,
        piso: raw.piso ? String(raw.piso) : null,
        fuente_precio: 'modelo-local',
        referencia_local_usd: referenciaLocal,
      });
      await sql`
        INSERT INTO tasacion_detalles (id_publicacion, datos)
        VALUES (${id}, ${detalles}::jsonb)
        ON CONFLICT (id_publicacion) DO UPDATE SET datos = EXCLUDED.datos
      `;
    } catch (detailError) {
      console.warn('No se pudo guardar el detalle ampliado de la tasación:', detailError.message);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Tasación actualizada con éxito",
        data: {
          id,
          barrio: barrio,
          superficie_cubierta: superficieCubierta,
          superficie_total: superficieTotal,
          superficie_descubierta: Math.max(superficieTotal - superficieCubierta, 0),
          precio_estimado_usd: referenciaLocal,
          tipo_operacion,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error al actualizar tasación:", error.message);
    return new Response(
      JSON.stringify({ error: "Error interno al procesar la actualización" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
