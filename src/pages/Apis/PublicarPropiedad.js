export const prerender = false;
import sql from '../../Backend/carga.js';
import { estimarPrecioVenta } from '../../lib/mercado';

const IA_URL = import.meta.env.IA_URL || process.env.IA_URL || 'http://127.0.0.1:8000';
const IA_TIMEOUT_MS = 15000;

const normalizar = (valor) => String(valor || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const tiene = (comodidades, nombre) =>
  Array.isArray(comodidades) &&
  comodidades.some((a) => normalizar(a) === normalizar(nombre));

const IA_API_KEY = import.meta.env.INTERNAL_API_KEY || process.env.INTERNAL_API_KEY || '';

async function geocodificar(direccion, barrio, ciudad) {
  const query = `${direccion}, ${barrio || ''}, ${ciudad || 'Buenos Aires'}, Argentina`;
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=ar`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SpatialValue/1.0 (tasaciones)' },
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch (e) {
    console.warn('Geocoding falló:', e.message);
  }
  return null;
}

async function llamarAI(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IA_TIMEOUT_MS);
  try {
    const res = await fetch(`${IA_URL}/estimar-precio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': IA_API_KEY,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.status === 'success' ? data : null;
  } catch (error) {
    console.error('IA no disponible:', error.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST({ request }) {
  try {
    const data = await request.json();

    const {
      titulo,
      descripcion,
      tipo_operacion = 'venta',
      tipo_propiedad = 'Departamento',
      precio,
      moneda = 'USD',
      expensas = 0,
      direccion,
      barrio,
      ciudad = 'Buenos Aires',
      ambientes = 1,
      dormitorios = 0,
      banos = 1,
      cocheras = 0,
      superficie_cubierta,
      superficie_total,
      piso,
      antiguedad,
      anios_de_antiguedad,
      orientacion,
      disposicion,
      comodidades,
      fotos = [],
      latitud,
      longitud,
      usuario_id,
    } = data;

    const idUsuarioFinal =
      [usuario_id, data.id_usuario].find(
        (v) => v && v !== 'undefined' && v !== 'null'
      ) || null;
    const estadoGeneral = data.estado_general ?? data.estadoGeneral;

    if (!titulo || !direccion || !idUsuarioFinal) {
      return new Response(
        JSON.stringify({ error: "Faltan campos obligatorios (título, dirección o usuario)" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const superficieCubierta = Number(superficie_cubierta) || 0;
    const superficieTotal = Number(superficie_total) || superficieCubierta;
    const tipoPropiedadDB = String(tipo_propiedad).toLowerCase();

    let coordenadasFinales = (latitud && longitud) ? { lat: Number(latitud), lng: Number(longitud) } : null;
    if (!coordenadasFinales) {
      coordenadasFinales = await geocodificar(direccion, barrio, ciudad);
    }
    const latFinal = coordenadasFinales?.lat ?? null;
    const lngFinal = coordenadasFinales?.lng ?? null;

    const payloadIA = {
      tipo_propiedad: tipo_propiedad === 'Casa' ? 'Casa' : 'Departamento',
      barrio_zona: barrio || ciudad || 'Capital Federal',
      ambientes: Number(ambientes) || 1,
      dormitorios: dormitorios ? Number(dormitorios) : null,
      banos: banos ? Number(banos) : null,
      superficie_total_m2: superficieTotal || null,
      superficie_cubierta_m2: superficieCubierta || null,
      estado: Number(estadoGeneral) >= 8 ? 'A estrenar' : 'Usado',
      anios_de_antiguedad: antiguedad != null ? Number(antiguedad) : (anios_de_antiguedad != null ? Number(anios_de_antiguedad) : null),
      piso: piso ? parseInt(String(piso).replace(/[^0-9]/g, ''), 10) || null : null,
      orientacion: orientacion || null,
      disposicion: disposicion || null,
      cochera: tiene(comodidades, 'Cochera'),
      balcon: tiene(comodidades, 'Balcón') || tiene(comodidades, 'Balcon'),
      terraza: tiene(comodidades, 'Terraza'),
      patio: tiene(comodidades, 'Patio'),
      pileta: tiene(comodidades, 'Pileta'),
      parrilla: tiene(comodidades, 'Parrilla'),
      seguridad_24hs: tiene(comodidades, 'Seguridad 24h'),
      ascensor: tiene(comodidades, 'Ascensor'),
      expensas_ars: Number(expensas) || 0,
      baulera: tiene(comodidades, 'Baulera'),
      sum: tiene(comodidades, 'SUM'),
      seguridad_tipo: tiene(comodidades, 'Seguridad 24h') ? '24hs' : 'Ninguno',
      camara: tiene(comodidades, 'Cámaras') || tiene(comodidades, 'Camaras'),
      gym: tiene(comodidades, 'Gimnasio'),
      lounge: tiene(comodidades, 'Lounge'),
      laundry: tiene(comodidades, 'Laundry'),
      tipo_operacion: String(tipo_operacion || 'venta').toLowerCase(),
      ...(latFinal != null ? { latitud: latFinal } : {}),
      ...(lngFinal != null ? { longitud: lngFinal } : {}),
    };

    const esAlquiler = String(tipo_operacion || 'venta').toLowerCase() === 'alquiler';

    let resultadoIA = null;
    let precioEstimadoUsd = null;

    resultadoIA = await llamarAI(payloadIA);
    precioEstimadoUsd = resultadoIA?.precio_estimado_usd ?? null;

    let precioFinal;
    if (precioEstimadoUsd != null) {
      precioFinal = Math.round(precioEstimadoUsd);
    } else if (esAlquiler) {
      precioFinal = Number(precio) || 0;
    } else {
      precioFinal = estimarPrecioVenta(
        superficieCubierta,
        Math.max(superficieTotal - superficieCubierta, 0),
        barrio || ciudad
      );
    }

    let publicacionGuardada = null;
    try {
      const nuevaPublicacion = await sql`
        INSERT INTO publicaciones (
          id_usuario,
          titulo,
          descripcion,
          tipo_operacion,
          tipo_propiedad,
          precio,
          precio_estimado_ia,
          moneda,
          expensas,
          superficie_total,
          superficie_cubierta,
          ambientes,
          dormitorios,
          banos,
          cocheras,
          direccion,
          barrio,
          ciudad,
          latitud,
          longitud
        )
        VALUES (
          ${idUsuarioFinal},
          ${titulo},
          ${descripcion || null},
          ${tipo_operacion},
          ${tipoPropiedadDB},
          ${precioFinal},
          ${precioEstimadoUsd != null ? Math.round(precioEstimadoUsd) : null},
          ${moneda},
          ${expensas},
          ${superficieTotal || null},
          ${superficieCubierta || null},
          ${Number(ambientes) || 1},
          ${dormitorios},
          ${banos},
          ${cocheras},
          ${direccion},
          ${barrio || null},
          ${ciudad},
          ${latFinal},
          ${lngFinal}
        )
        RETURNING *;
      `;
      publicacionGuardada = nuevaPublicacion[0];

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
          antiguedad: payloadIA.anios_de_antiguedad,
          orientacion: payloadIA.orientacion,
          disposicion: payloadIA.disposicion,
          estadoGeneral: Number(estadoGeneral) || null,
          comodidades: Array.isArray(comodidades) ? comodidades : [],
          fotos: Array.isArray(fotos) ? fotos : [],
        });
        await sql`
          INSERT INTO tasacion_detalles (id_publicacion, datos)
          VALUES (${publicacionGuardada.id_publicacion}, ${detalles}::jsonb)
          ON CONFLICT (id_publicacion) DO UPDATE SET datos = EXCLUDED.datos
        `;
      } catch (detailError) {
        console.warn('No se pudo guardar el detalle ampliado de la tasación:', detailError.message);
      }
    } catch (error) {
      console.error("No se pudo guardar la publicación (igual se devuelve la estimación):", error.message);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: publicacionGuardada
          ? "Publicación creada con éxito"
          : "Tasación estimada (no guardada: usuario inválido o servicio de datos no disponible)",
        data: {
          id: publicacionGuardada?.id_publicacion ?? null,
          precio_estimado_usd: precioEstimadoUsd != null ? Math.round(precioEstimadoUsd) : null,
          coordenadas: resultadoIA?.coordenadas ?? null,
          saved: Boolean(publicacionGuardada),
        },
      }),
      { status: publicacionGuardada ? 201 : 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error al crear publicación:", error.message);
    return new Response(
      JSON.stringify({ error: "Error interno al procesar la publicación" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
