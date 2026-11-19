import { randomUUID } from 'node:crypto';
import {
  MAX_ARCHIVOS,
  MAX_GLB_BYTES,
  MAX_MEDIA_BYTES,
  MAX_TOTAL_BYTES,
  clasificarArchivo,
  crearFila,
  borrarFila,
  errorConfiguracion,
  estadoDesdeFila,
  firmarSubida,
  listarTrabajos,
  responderJson,
  rutaMedia,
  rutaModelo,
  visorOperativo,
} from '../../../Backend/visor-supabase.js';
import { liberarOrden, reservarOrden } from '../../../Backend/pagos.js';
import { consultarSaldoKiri, kiriConfigurado } from '../../../Backend/visor-kiri.js';
import { mast3rConfigurado } from '../../../Backend/visor-mast3r.js';
import {
  esPublicacionDelUsuario,
  esUuid,
  exigirSesion,
  limitar,
} from '../../../Backend/seguridad.js';

export const prerender = false;

const CALIDADES = new Set(['rapida', 'equilibrada', 'alta', 'auto']);

const texto = (valor) => (typeof valor === 'string' && valor.trim() ? valor.trim() : null);

export async function GET({ url, request }) {
  if (!visorOperativo()) {
    return responderJson(503, { error: errorConfiguracion() });
  }

  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`visor-listar:${sesion.usuarioId}`, 120, 60_000))) {
    return responderJson(429, { error: 'Demasiadas consultas. Esperá un momento.' });
  }

  const publicacionId = texto(url.searchParams.get('publicacion_id'));

  if (!publicacionId) {
    return responderJson(400, { error: 'Filtrá por publicacion_id.' });
  }
  if (!esUuid(publicacionId) || !(await esPublicacionDelUsuario(sesion.usuarioId, publicacionId))) {
    return responderJson(403, { error: 'No tenés permiso para ver el visor de esa publicación.' });
  }

  try {
    const filas = await listarTrabajos({ publicacionId, limite: 3 });
    return responderJson(200, { trabajos: filas.map(estadoDesdeFila).filter(Boolean) });
  } catch (e) {
    return responderJson(502, {
      error: e instanceof Error ? e.message : 'No se pudieron listar los trabajos del visor.',
    });
  }
}

export async function POST({ request }) {
  if (!visorOperativo()) {
    return responderJson(503, { error: errorConfiguracion() });
  }

  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`visor-crear:${sesion.usuarioId}`, 12, 3_600_000))) {
    return responderJson(429, { error: 'Demasiados modelos pedidos. Probá más tarde.' });
  }

  let cuerpo;
  try {
    cuerpo = await request.json();
  } catch {
    return responderJson(400, { error: 'Cuerpo JSON inválido.' });
  }

  const tipo = cuerpo?.tipo === 'modelo' ? 'modelo' : 'media';
  const archivos = Array.isArray(cuerpo?.archivos) ? cuerpo.archivos : [];

  if (!archivos.length) {
    return responderJson(400, { error: 'Faltan los archivos a subir.' });
  }
  if (archivos.length > MAX_ARCHIVOS) {
    return responderJson(400, { error: `Máximo ${MAX_ARCHIVOS} archivos por modelo.` });
  }
  if (tipo === 'modelo' && archivos.length !== 1) {
    return responderJson(400, { error: 'Se sube un modelo .glb por vez.' });
  }

  const publicacionId = texto(cuerpo?.id_publicacion);
  if (publicacionId) {
    if (
      !esUuid(publicacionId) ||
      !(await esPublicacionDelUsuario(sesion.usuarioId, publicacionId))
    ) {
      return responderJson(403, { error: 'La publicación no pertenece a tu cuenta.' });
    }
  }

  const id = randomUUID();
  const limite = tipo === 'modelo' ? MAX_GLB_BYTES : MAX_MEDIA_BYTES;
  const objetivos = [];
  let total = 0;

  for (const [indice, archivo] of archivos.entries()) {
    const nombre = String(archivo?.nombre || '');
    const tamano = Number(archivo?.tamano) || 0;
    const etiqueta = nombre || `archivo ${indice + 1}`;

    if (!tamano) {
      return responderJson(400, { error: `El archivo ${etiqueta} llegó vacío.` });
    }
    if (tamano > limite) {
      return responderJson(413, {
        error: `El archivo ${etiqueta} supera el máximo de ${Math.round(limite / 1024 / 1024)} MB.`,
      });
    }

    total += tamano;
    if (total > MAX_TOTAL_BYTES) {
      return responderJson(413, {
        error: `El modelo supera el máximo total de ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)} MB.`,
      });
    }

    if (tipo === 'modelo') {
      if (!/\.glb$/i.test(nombre)) {
        return responderJson(400, { error: 'El modelo tiene que estar en formato .glb.' });
      }
      objetivos.push({
        nombre,
        ruta: rutaModelo(id),
        contentType: 'model/gltf-binary',
        clase: 'modelo',
      });
      continue;
    }

    const clase = clasificarArchivo(archivo?.tipo, nombre);
    if (!clase) {
      return responderJson(400, {
        error: `Formato no soportado: ${etiqueta}. Usá fotos JPG/PNG/HEIC o un video MP4/MOV.`,
      });
    }
    objetivos.push({
      nombre,
      ruta: rutaMedia(id, indice, nombre),
      contentType:
        String(archivo?.tipo || '') || (clase === 'video' ? 'video/mp4' : 'image/jpeg'),
      clase,
    });
  }

  if (tipo === 'media') {
    const videos = objetivos.filter((objetivo) => objetivo.clase === 'video').length;
    const fotos = objetivos.filter((objetivo) => objetivo.clase === 'imagen').length;

    if (videos > 1) {
      return responderJson(400, { error: 'Se sube un solo video por modelo.' });
    }
    if (videos === 1 && fotos > 0) {
      return responderJson(400, { error: 'Elegí fotos o un video, no ambos.' });
    }
    if (videos === 0 && fotos < 20) {
      return responderJson(400, { error: 'Se necesitan al menos 20 fotos para el modelo 3D.' });
    }
  }

  let pagoReservado = false;

  if (tipo === 'media') {
    if (!kiriConfigurado() && !mast3rConfigurado()) {
      return responderJson(503, {
        error: 'El motor 3D no está configurado. No se te cobró nada.',
      });
    }

    const saldo = await consultarSaldoKiri();
    if (saldo !== null && saldo < 1) {
      return responderJson(503, {
        error: 'No hay créditos del motor 3D disponibles. No se te cobró nada.',
      });
    }

    const pagoId = texto(cuerpo?.pago_id);
    if (!pagoId) {
      return responderJson(402, { error: 'Falta el pago del modelo 3D.' });
    }
    pagoReservado = await reservarOrden(sesion.usuarioId, pagoId, id);
    if (!pagoReservado) {
      return responderJson(402, {
        error: 'El pago no está acreditado o ya se usó para otro modelo.',
      });
    }
  }

  try {
    await crearFila({
      id,
      titulo: String(cuerpo?.titulo || 'Gemelo digital').slice(0, 200),
      usuario_id: sesion.usuarioId,
      publicacion_id: publicacionId,
      estado: 'subiendo',
      etapa: 'recibiendo',
      progreso: 5,
      mensaje:
        tipo === 'modelo'
          ? 'Preparando la subida del modelo .glb…'
          : 'Preparando la subida del material…',
      motor: 'supabase',
      es_video: objetivos.some((objetivo) => objetivo.clase === 'video'),
      n_fotos: objetivos.filter((objetivo) => objetivo.clase === 'imagen').length,
      calidad: CALIDADES.has(String(cuerpo?.calidad)) ? String(cuerpo?.calidad) : null,
      media_paths: tipo === 'modelo' ? [] : objetivos.map((objetivo) => objetivo.ruta),
      expira_en: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const subidas = [];
    for (const objetivo of objetivos) {
      const { url } = await firmarSubida(objetivo.ruta);
      subidas.push({
        nombre: objetivo.nombre,
        path: objetivo.ruta,
        url,
        contentType: objetivo.contentType,
      });
    }

    return responderJson(200, { id, tipo, subidas });
  } catch (e) {
    if (pagoReservado) await liberarOrden(id).catch(() => {});
    await borrarFila(id).catch(() => {});
    return responderJson(502, {
      error: e instanceof Error ? e.message : 'No se pudo preparar la subida del visor 3D.',
      id: null,
    });
  }
}
