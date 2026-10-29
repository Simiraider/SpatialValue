import {
  MAX_GLB_BYTES,
  MAX_MEDIA_BYTES,
  clasificarArchivo,
  crearFila,
  errorConfiguracion,
  estadoDesdeFila,
  firmarSubida,
  listarTrabajos,
  responderJson,
  rutaMedia,
  rutaModelo,
  visorOperativo,
} from '../../../Backend/visor-supabase.js';

export const prerender = false;

const texto = (valor) => (typeof valor === 'string' && valor.trim() ? valor.trim() : null);

export async function GET({ url }) {
  if (!visorOperativo()) {
    return responderJson(503, { error: errorConfiguracion() });
  }

  const publicacionId = texto(url.searchParams.get('publicacion_id'));
  const usuarioId = texto(url.searchParams.get('usuario_id'));
  if (!publicacionId && !usuarioId) {
    return responderJson(400, { error: 'Filtrá por publicacion_id o usuario_id.' });
  }

  try {
    const filas = await listarTrabajos({ publicacionId, usuarioId, limite: 3 });
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
  if (tipo === 'modelo' && archivos.length !== 1) {
    return responderJson(400, { error: 'Se sube un modelo .glb por vez.' });
  }

  const id = crypto.randomUUID();
  const limite = tipo === 'modelo' ? MAX_GLB_BYTES : MAX_MEDIA_BYTES;
  const objetivos = [];

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

  try {
    await crearFila({
      id,
      titulo: String(cuerpo?.titulo || 'Gemelo digital').slice(0, 200),
      usuario_id: texto(cuerpo?.id_usuario),
      publicacion_id: texto(cuerpo?.id_publicacion),
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
      calidad: texto(cuerpo?.calidad),
      media_paths: tipo === 'modelo' ? [] : objetivos.map((objetivo) => objetivo.ruta),
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
    return responderJson(502, {
      error: e instanceof Error ? e.message : 'No se pudo preparar la subida del visor 3D.',
      id: null,
    });
  }
}
