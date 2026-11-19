import { Client, handle_file } from '@gradio/client';
import {
  LIMITE_PROCESO_MS,
  MAX_GLB_BYTES,
  abrirObjeto,
  actualizarFila,
  marcarDemo,
  rutaModelo,
  subirObjeto,
} from './visor-supabase.js';

export const ESPACIO_MAST3R = (process.env.MAST3R_SPACE || 'naver/MASt3R').trim() || 'naver/MASt3R';
export const MAX_CUADROS = 8;

const API_MAST3R = '/local_get_reconstructed_scene';

export const mast3rConfigurado = () =>
  String(process.env.MAST3R_DESHABILITADO || '').trim() !== '1';

function conLimite(promesa, ms, mensaje) {
  let temporizador;
  const limite = new Promise((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error(mensaje)), ms);
  });
  promesa.catch(() => {});
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
}

async function prepararCuadros(rutas) {
  const cuadros = [];
  for (const ruta of rutas.slice(0, MAX_CUADROS)) {
    try {
      const respuesta = await abrirObjeto(ruta);
      if (!respuesta?.ok) continue;
      const tipo = String(respuesta.headers.get('content-type') || 'image/jpeg').split(';')[0];
      const esImagen = tipo.startsWith('image/') || /\.(jpe?g|png|webp|avif|heic|heif)$/i.test(String(ruta));
      if (!esImagen) continue;
      const bytes = await respuesta.arrayBuffer();
      if (!bytes.byteLength) continue;
      const nombre = String(ruta).split('/').pop() || `cuadro-${cuadros.length + 1}.jpg`;
      cuadros.push(handle_file(new File([bytes], nombre, { type: tipo })));
    } catch (e) {
      console.error(`No se pudo preparar ${ruta}:`, e);
    }
  }
  return cuadros;
}

async function reconstruir(cuadros) {
  const token = String(process.env.HF_TOKEN || '').trim();
  const client = await Client.connect(ESPACIO_MAST3R, token ? { token } : {});

  const resultado = await client.predict(API_MAST3R, {
    inputfiles: cuadros,
    min_conf_thr: 1.5,
    matching_conf_thr: 0,
    as_pointcloud: false,
    cam_size: 0.2,
    shared_intrinsics: false,
  });

  const datos = Array.isArray(resultado?.data) ? resultado.data : [];
  const modelo = datos[1] || datos[0];
  const url = typeof modelo === 'string' ? modelo : modelo?.url;
  if (!url) throw new Error('MASt3R no devolvió un modelo 3D.');
  return url;
}

export async function procesarConMASt3R(trabajoId, rutas) {
  await actualizarFila(trabajoId, {
    estado: 'procesando',
    etapa: 'reconstruyendo',
    progreso: 30,
    mensaje: 'Enviando las fotos a MASt3R y estimando las cámaras…',
    proveedor: 'mast3r',
    chequeo_en: new Date().toISOString(),
    error: null,
  });

  try {
    const lista = Array.isArray(rutas) ? rutas : [];
    const cuadros = await prepararCuadros(lista);
    if (cuadros.length < 5) {
      throw new Error(`Solo hay ${cuadros.length} fotos válidas y MASt3R necesita al menos 5.`);
    }

    await actualizarFila(trabajoId, {
      progreso: 45,
      mensaje: `Reconstruyendo ${cuadros.length} fotos en la GPU de MASt3R…`,
    });

    const glbUrl = await conLimite(
      reconstruir(cuadros),
      LIMITE_PROCESO_MS,
      'MASt3R no terminó de procesar en 10 minutos.'
    );

    await actualizarFila(trabajoId, {
      progreso: 80,
      mensaje: 'Descargando el modelo y guardándolo en Supabase…',
    });

    const respuesta = await fetch(glbUrl, { signal: AbortSignal.timeout(120_000) });
    if (!respuesta.ok) throw new Error(`No se pudo descargar el modelo (HTTP ${respuesta.status}).`);

    const glbBytes = new Uint8Array(await respuesta.arrayBuffer());
    if (!glbBytes.length) throw new Error('MASt3R devolvió un archivo vacío.');
    if (glbBytes.length > MAX_GLB_BYTES) {
      throw new Error(`El modelo pesa más de ${Math.round(MAX_GLB_BYTES / 1024 / 1024)} MB.`);
    }

    await subirObjeto(rutaModelo(trabajoId), glbBytes, 'model/gltf-binary');

    return await actualizarFila(trabajoId, {
      estado: 'listo',
      etapa: 'listo',
      progreso: 100,
      motor: 'mast3r',
      mensaje: 'Modelo 3D reconstruido con MASt3R.',
      modelo_path: rutaModelo(trabajoId),
      modelo_bytes: glbBytes.length,
      chequeo_en: null,
      error: null,
    });
  } catch (e) {
    const motivo = e instanceof Error ? e.message : 'El procesamiento 3D falló.';
    console.error('MASt3R:', motivo);
    return marcarDemo(trabajoId, motivo);
  }
}
