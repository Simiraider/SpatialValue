export const prerender = false;
import sql from '../../Backend/carga.js';
import { estimarPrecioVenta } from '../../lib/mercado';

const IA_URL = import.meta.env.IA_URL || process.env.IA_URL || 'http://127.0.0.1:8000';
const IA_TIMEOUT_MS = 15000;

const tiene = (comodidades, nombre) =>
  Array.isArray(comodidades) &&
  comodidades.some((a) => String(a).toLowerCase() === nombre.toLowerCase());

const IA_API_KEY = import.meta.env.INTERNAL_API_KEY || process.env.INTERNAL_API_KEY || '';

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
      comodidades,
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

    const payloadIA = {
      tipo_propiedad: tipo_propiedad === 'Casa' ? 'Casa' : 'Departamento',
      barrio_zona: barrio || ciudad || 'Capital Federal',
      ambientes: Number(ambientes) || 1,
      dormitorios: dormitorios ? Number(dormitorios) : null,
      banos: banos ? Number(banos) : null,
      superficie_total_m2: superficieTotal || null,
      superficie_cubierta_m2: superficieCubierta || null,
      estado: Number(estadoGeneral) >= 8 ? 'A estrenar' : 'Usado',
      anios_de_antiguedad: null,
      piso: piso ? Number(piso) : null,
      orientacion: null,
      disposicion: null,
      cochera: tiene(comodidades, 'Cochera'),
      balcon: tiene(comodidades, 'Balcón') || tiene(comodidades, 'Balcon'),
      terraza: false,
      patio: tiene(comodidades, 'Patio'),
      pileta: tiene(comodidades, 'Pileta'),
      parrilla: tiene(comodidades, 'Parrilla'),
      seguridad_24hs: tiene(comodidades, 'Seguridad 24h'),
      ascensor: false,
      expensas_ars: Number(expensas) || 0,
      baulera: false,
      sum: tiene(comodidades, 'SUM'),
      seguridad_tipo: 'Ninguno',
      camara: false,
      gym: tiene(comodidades, 'Gimnasio'),
      lounge: false,
      laundry: false,
      tipo_operacion: String(tipo_operacion || 'venta').toLowerCase(),
      ...(latitud != null && latitud !== '' ? { latitud: Number(latitud) } : {}),
      ...(longitud != null && longitud !== '' ? { longitud: Number(longitud) } : {}),
    };

    const esAlquiler = String(tipo_operacion || 'venta').toLowerCase() === 'alquiler';

    let resultadoIA = await llamarAI(payloadIA);
    let precioIA = resultadoIA?.precio_estimado_usd ?? null;

    const RENTABILIDAD_ANUAL = 0.045;
    let precioFinal;
    let precioEstimadoUsd;

    if (esAlquiler) {
      const alquilerMensualUsd = precioIA != null ? Math.round(precioIA * RENTABILIDAD_ANUAL / 12) : null;
      precioEstimadoUsd = alquilerMensualUsd;
      precioFinal = alquilerMensualUsd != null ? alquilerMensualUsd : Number(precio) || 0;
    } else {
      precioEstimadoUsd = precioIA;
      precioFinal = precioIA != null ? Math.round(precioIA) : estimarPrecioVenta(
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
          ${precioEstimadoUsd ?? null},
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
          ${latitud || null},
          ${longitud || null}
        )
        RETURNING *;
      `;
      publicacionGuardada = nuevaPublicacion[0];
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
