export const prerender = false;
import sql from '../../Backend/carga.js';

const IA_URL = import.meta.env.IA_URL || process.env.IA_URL || 'http://127.0.0.1:8000';
const IA_TIMEOUT_MS = 15000;

const tiene = (comodidades, nombre) =>
  Array.isArray(comodidades) &&
  comodidades.some((a) => String(a).toLowerCase() === nombre.toLowerCase());

async function llamarAI(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IA_TIMEOUT_MS);
  try {
    const res = await fetch(`${IA_URL}/estimar-precio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Solo tomamos como válido el estado "success"; "warning" significa modelo sin datos
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
      usuario_id, // O id_usuario
    } = data;

    const idUsuarioFinal = usuario_id || data.id_usuario;
    // El form envía "estadoGeneral" (slider 1-10)
    const estadoGeneral = data.estado_general ?? data.estadoGeneral;

    // Validación de campos obligatorios. El precio NO es obligatorio: lo estima la IA.
    if (!titulo || !direccion || !idUsuarioFinal) {
      return new Response(
        JSON.stringify({ error: "Faltan campos obligatorios (título, dirección o usuario)" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const superficieCubierta = Number(superficie_cubierta) || 0;
    const superficieTotal = Number(superficie_total) || superficieCubierta;

    // Mapeo al schema que espera la IA (api_ia.py → PropiedadInput)
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
      ...(latitud != null && latitud !== '' ? { latitud: Number(latitud) } : {}),
      ...(longitud != null && longitud !== '' ? { longitud: Number(longitud) } : {}),
    };

    // 1) Estimación de la IA (server-side, evita problemas de CORS)
    const resultadoIA = await llamarAI(payloadIA);
    const precioEstimadoUsd = resultadoIA?.precio_estimado_usd ?? null;
    const precioFinal = precioEstimadoUsd != null ? Math.round(precioEstimadoUsd) : Number(precio) || 0;

    // 2) Guardado en la base (puede fallar si el usuario no existe: igual devolvemos la estimación)
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
          ${tipo_propiedad},
          ${precioFinal},
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
          id: publicacionGuardada?.id ?? null,
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
