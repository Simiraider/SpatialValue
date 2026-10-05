export const prerender = false;
import sql from '../../Backend/carga.js';
import { estimarPrecioVenta } from '../../lib/mercado';
import { verificarDireccion, canonizarBarrio } from '../../lib/verificar-direccion';
import { resolverUsuarioId, permitirFrecuencia, ipDePeticion } from '../../Backend/sesion.js';

const IA_URL = import.meta.env.IA_URL || process.env.IA_URL || 'http://127.0.0.1:8000';
const IA_API_KEY = import.meta.env.INTERNAL_API_KEY || process.env.INTERNAL_API_KEY || '';
const IA_TIMEOUT_MS = 15000;

const AMENITIES_VALIDOS = new Set([
  'Seguridad 24h', 'Ascensor', 'Cochera', 'Gimnasio', 'Baulera', 'Cámaras',
  'Balcón', 'Lounge', 'Terraza', 'Pileta', 'Patio', 'Parrilla', 'Laundry', 'SUM',
]);
const MAX_TITULO = 200;
const MAX_DESCRIPCION = 2000;
const MAX_FOTOS = 12;
const MAX_COMODIDADES = 30;

const numeroEnRango = (v, min, max, defecto) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return defecto;
  return Math.min(Math.max(Math.round(n), min), max);
};

const textoLimpio = (v, max) => String(v ?? '').trim().slice(0, max);

const normalizar = (valor) => String(valor || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const tiene = (comodidades, nombre) =>
  Array.isArray(comodidades) &&
  comodidades.some((a) => normalizar(a) === normalizar(nombre));

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
    if (!permitirFrecuencia(`publicar:${ipDePeticion(request)}`, 20, 3_600_000)) {
      return new Response(
        JSON.stringify({ error: "Demasiadas publicaciones seguidas. Probá de nuevo más tarde." }),
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

    const titulo = textoLimpio(raw.titulo, MAX_TITULO);
    const descripcion = textoLimpio(raw.descripcion, MAX_DESCRIPCION);
    const direccion = textoLimpio(raw.direccion, 200);
    const barrio = textoLimpio(raw.barrio, 100);
    const ciudad = textoLimpio(raw.ciudad, 100) || 'Buenos Aires';
    const tipoOperacionRaw = String(raw.tipo_operacion ?? 'venta').toLowerCase();
    const tipo_operacion = tipoOperacionRaw === 'alquiler' ? 'alquiler' : 'venta';
    const tipo_propiedad = String(raw.tipo_propiedad ?? 'Departamento') === 'Casa' ? 'Casa' : 'Departamento';
    const moneda = String(raw.moneda ?? 'USD') === 'ARS' ? 'ARS' : 'USD';

    const comodidades = (Array.isArray(raw.comodidades) ? raw.comodidades : [])
      .slice(0, MAX_COMODIDADES)
      .map((c) => String(c ?? '').trim())
      .filter((c) => c && AMENITIES_VALIDOS.has(c));

    const fotos = (Array.isArray(raw.fotos) ? raw.fotos : [])
      .slice(0, MAX_FOTOS)
      .map((f) => ({
        name: textoLimpio(f?.name, 120),
        size: numeroEnRango(f?.size, 0, 20_000_000, 0),
        type: textoLimpio(f?.type, 50),
      }));

    if (!titulo || !direccion) {
      return new Response(
        JSON.stringify({ error: "Faltan campos obligatorios (título o dirección)" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const superficieCubierta = numeroEnRango(raw.superficie_cubierta, 1, 10000, 0);
    const superficieTotal = Math.max(numeroEnRango(raw.superficie_total, 1, 10000, superficieCubierta), superficieCubierta);
    const ambientes = numeroEnRango(raw.ambientes, 1, 50, 1);
    const dormitorios = numeroEnRango(raw.dormitorios, 0, 30, 0);
    const banos = numeroEnRango(raw.banos, 0, 30, 1);
    const cocheras = numeroEnRango(raw.cocheras, 0, 10, 0);
    const expensas = numeroEnRango(raw.expensas, 0, 10_000_000, 0);
    const estadoGeneralRaw = Number(raw.estado_general ?? raw.estadoGeneral ?? 7);
    const estadoGeneral = Number.isFinite(estadoGeneralRaw) ? Math.min(Math.max(estadoGeneralRaw, 1), 10) : 7;
    const piso = raw.piso ? parseInt(String(raw.piso).replace(/[^0-9]/g, ''), 10) || null : null;
    const antiguedad = numeroEnRango(raw.antiguedad ?? raw.anios_de_antiguedad, 0, 200, 0) || null;
    const orientacion = textoLimpio(raw.orientacion, 30) || null;
    const disposicion = textoLimpio(raw.disposicion, 30) || null;
    const luzNatural = textoLimpio(raw.luz_natural ?? raw.luzNatural, 30) || null;
    const es_borrador = Boolean(raw.es_borrador);

    let coordenadasFinales = null;
    const latRaw = Number(raw.latitud);
    const lngRaw = Number(raw.longitud);
    if (Number.isFinite(latRaw) && Number.isFinite(lngRaw) && Math.abs(latRaw) <= 90 && Math.abs(lngRaw) <= 180) {
      coordenadasFinales = { lat: latRaw, lng: lngRaw };
    }

    let barrioCoincide = true;
    let barrioDetectado = null;
    let direccionFormateada = null;
    let fuenteGeocoding = null;
    if (!coordenadasFinales) {
      const verificacion = await verificarDireccion(direccion, barrio, ciudad);
      if (verificacion.existe) {
        coordenadasFinales = { lat: verificacion.lat, lng: verificacion.lng };
        barrioDetectado = verificacion.barrioDetectado;
        direccionFormateada = verificacion.direccionFormateada;
        fuenteGeocoding = verificacion.fuente;
        barrioCoincide = verificacion.barrioDetectado ? verificacion.barrioCoincide : true;
      }
    }
    const latFinal = coordenadasFinales?.lat ?? null;
    const lngFinal = coordenadasFinales?.lng ?? null;
    const barrioFinal = canonizarBarrio(barrio || canonizarBarrio(barrioDetectado)) || barrio || null;

    const payloadIA = {
      tipo_propiedad,
      barrio_zona: barrioFinal || ciudad || 'Capital Federal',
      ambientes,
      dormitorios: dormitorios || null,
      banos: banos || null,
      superficie_total_m2: superficieTotal || null,
      superficie_cubierta_m2: superficieCubierta || null,
      estado: estadoGeneral >= 8 ? 'A estrenar' : 'Usado',
      anios_de_antiguedad: antiguedad,
      piso,
      orientacion,
      disposicion,
      cochera: tiene(comodidades, 'Cochera'),
      balcon: tiene(comodidades, 'Balcón'),
      terraza: tiene(comodidades, 'Terraza'),
      patio: tiene(comodidades, 'Patio'),
      pileta: tiene(comodidades, 'Pileta'),
      parrilla: tiene(comodidades, 'Parrilla'),
      seguridad_24hs: tiene(comodidades, 'Seguridad 24h'),
      ascensor: tiene(comodidades, 'Ascensor'),
      expensas_ars: expensas,
      baulera: tiene(comodidades, 'Baulera'),
      sum: tiene(comodidades, 'SUM'),
      seguridad_tipo: tiene(comodidades, 'Seguridad 24h') ? '24hs' : 'Ninguno',
      camara: tiene(comodidades, 'Cámaras'),
      gym: tiene(comodidades, 'Gimnasio'),
      lounge: tiene(comodidades, 'Lounge'),
      laundry: tiene(comodidades, 'Laundry'),
      tipo_operacion,
      ...(latFinal != null ? { latitud: latFinal } : {}),
      ...(lngFinal != null ? { longitud: lngFinal } : {}),
    };

    const esAlquiler = tipo_operacion === 'alquiler';

    let resultadoIA = null;
    let precioEstimadoUsd = null;

    resultadoIA = await llamarAI(payloadIA);
    precioEstimadoUsd = resultadoIA?.precio_estimado_usd ?? null;

    const referenciaLocal = estimarPrecioVenta(
      superficieCubierta,
      Math.max(superficieTotal - superficieCubierta, 0),
      barrioFinal || ciudad
    );

    let precioFinal;
    let fuentePrecio;
    if (!esAlquiler && precioEstimadoUsd != null && precioEstimadoUsd > 0) {
      const dentroDeBanda = precioEstimadoUsd >= referenciaLocal * 0.6 && precioEstimadoUsd <= referenciaLocal * 1.5;
      if (dentroDeBanda) {
        precioFinal = Math.round(precioEstimadoUsd);
        fuentePrecio = 'ia';
      } else {
        precioFinal = referenciaLocal;
        fuentePrecio = 'modelo-local';
        console.warn(`IA fuera de banda (${Math.round(precioEstimadoUsd)} vs referencia ${referenciaLocal}): se usa estimación local`);
      }
    } else if (esAlquiler) {
      precioFinal = 0;
      fuentePrecio = 'sin-estimacion';
    } else {
      precioFinal = referenciaLocal;
      fuentePrecio = 'modelo-local';
    }

    let publicacionGuardada = null;
    try {
      await sql`ALTER TABLE publicaciones ADD COLUMN IF NOT EXISTS estado_tasacion varchar(20) NOT NULL DEFAULT 'completada'`;
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
          longitud,
          estado_tasacion
        )
        VALUES (
          ${idUsuarioFinal},
          ${titulo},
          ${descripcion || null},
          ${tipo_operacion},
          ${tipo_propiedad.toLowerCase()},
          ${precioFinal},
          ${precioEstimadoUsd != null ? Math.round(precioEstimadoUsd) : null},
          ${moneda},
          ${expensas},
          ${superficieTotal || null},
          ${superficieCubierta || null},
          ${ambientes},
          ${dormitorios},
          ${banos},
          ${cocheras},
          ${direccion},
          ${barrioFinal},
          ${ciudad},
          ${latFinal},
          ${lngFinal},
          ${es_borrador ? 'borrador' : 'completada'}
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
          antiguedad,
          orientacion,
          disposicion,
          luzNatural,
          estadoGeneral,
          comodidades,
          fotos,
          fuente_precio: fuentePrecio,
          referencia_local_usd: referenciaLocal,
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
          : "Tasación estimada (no guardada: servicio de datos no disponible)",
        data: {
          id: publicacionGuardada?.id_publicacion ?? null,
          precio_estimado_usd: precioEstimadoUsd != null ? Math.round(precioEstimadoUsd) : null,
          coordenadas: resultadoIA?.coordenadas ?? (latFinal != null ? { lat: latFinal, lng: lngFinal } : null),
          direccion_verificada: Boolean(latFinal),
          direccion_formateada: direccionFormateada,
          barrio_detectado: barrioDetectado,
          barrio_coincide: barrioCoincide,
          fuente_geocoding: fuenteGeocoding,
          fuente_precio: fuentePrecio,
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
