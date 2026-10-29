import type {
  ConfigGemelo,
  DatosModeloExterno,
  DatosSubida,
  EstadoTrabajo,
} from './gemelo';

interface SubidaFirmada {
  nombre: string;
  path: string;
  url: string;
  contentType: string;
}

interface TrabajoFirmado {
  id: string;
  tipo: 'media' | 'modelo';
  subidas: SubidaFirmada[];
}

const url = (config: ConfigGemelo, ruta: string) => `${config.workerUrl}${ruta}`;

export const visorEnSupabase = (config: ConfigGemelo): boolean =>
  config.almacenamiento === 'supabase';

async function leerJson<T>(respuesta: Response): Promise<T | null> {
  try {
    return (await respuesta.json()) as T;
  } catch {
    return null;
  }
}

async function crearTrabajo(
  config: ConfigGemelo,
  cuerpo: Record<string, unknown>
): Promise<TrabajoFirmado> {
  const respuesta = await fetch(url(config, '/api/visor/trabajos'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(30000),
  });
  const datos = await leerJson<TrabajoFirmado & { error?: string }>(respuesta);
  if (!respuesta.ok || !datos?.id || !Array.isArray(datos.subidas)) {
    throw new Error(datos?.error || `Error ${respuesta.status} al preparar el trabajo 3D.`);
  }
  return datos;
}

function subirFirmado(
  subida: SubidaFirmada,
  archivo: File,
  onProgreso?: (fraccion: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', subida.url);
    xhr.setRequestHeader(
      'Content-Type',
      subida.contentType || archivo.type || 'application/octet-stream'
    );
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable && onProgreso) onProgreso(evento.loaded / evento.total);
    };
    xhr.timeout = 30 * 60 * 1000;
    xhr.onerror = () =>
      reject(new Error(`No se pudo subir ${subida.nombre} a Supabase (revisá la conexión).`));
    xhr.ontimeout = () =>
      reject(new Error(`La subida de ${subida.nombre} superó el tiempo máximo.`));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Falló la subida de ${subida.nombre} (HTTP ${xhr.status}).`));
    };
    xhr.send(archivo);
  });
}

export async function enviarAKiriSupabase(
  config: ConfigGemelo,
  id: string
): Promise<EstadoTrabajo> {
  const respuesta = await fetch(url(config, `/api/visor/trabajos/${id}/enviar`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(150000),
  });
  const estado = await leerJson<EstadoTrabajo & { error?: string }>(respuesta);
  if (!respuesta.ok || !estado?.id) {
    throw new Error(estado?.error || `No se pudo enviar a KIRI (HTTP ${respuesta.status}).`);
  }
  return estado;
}

export async function subirTrabajoSupabase(
  config: ConfigGemelo,
  datos: DatosSubida
): Promise<{ id: string }> {
  const archivos = datos.archivos;
  if (!archivos.length) throw new Error('No hay archivos para subir.');

  const trabajo = await crearTrabajo(config, {
    titulo: datos.titulo || 'Gemelo digital',
    id_usuario: datos.idUsuario || null,
    id_publicacion: datos.idPublicacion || null,
    calidad: datos.calidad,
    tipo: 'media',
    archivos: archivos.map((archivo) => ({
      nombre: archivo.name,
      tipo: archivo.type,
      tamano: archivo.size,
    })),
  });

  if (trabajo.subidas.length !== archivos.length) {
    throw new Error('El servidor no habilitó la subida de todos los archivos.');
  }

  const total = archivos.reduce((suma, archivo) => suma + archivo.size, 0) || 1;
  let enviado = 0;

  for (const [indice, archivo] of archivos.entries()) {
    const subida = trabajo.subidas[indice];
    await subirFirmado(subida, archivo, (fraccion) => {
      datos.onProgreso?.((enviado + fraccion * archivo.size) / total);
    });
    enviado += archivo.size;
  }

  const respuesta = await fetch(url(config, `/api/visor/trabajos/${trabajo.id}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'subida_completa' }),
    signal: AbortSignal.timeout(60000),
  });
  const estado = await leerJson<EstadoTrabajo & { error?: string; enviar?: boolean }>(respuesta);
  if (!respuesta.ok) {
    throw new Error(estado?.error || `No se pudo confirmar la subida (HTTP ${respuesta.status}).`);
  }

  if (estado?.enviar) {
    await enviarAKiriSupabase(config, trabajo.id).catch(() => null);
  }

  return { id: trabajo.id };
}

export async function subirModeloGLBSupabase(
  config: ConfigGemelo,
  datos: DatosModeloExterno
): Promise<EstadoTrabajo> {
  const trabajo = await crearTrabajo(config, {
    titulo: datos.titulo || 'Modelo 3D externo',
    id_usuario: datos.idUsuario || null,
    id_publicacion: datos.idPublicacion || null,
    tipo: 'modelo',
    archivos: [
      {
        nombre: datos.archivo.name || 'modelo.glb',
        tipo: 'model/gltf-binary',
        tamano: datos.archivo.size,
      },
    ],
  });

  const subida = trabajo.subidas[0];
  if (!subida) throw new Error('El servidor no habilitó la subida del modelo.');

  await subirFirmado(subida, datos.archivo);

  const respuesta = await fetch(url(config, `/api/visor/trabajos/${trabajo.id}/modelo`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: subida.path }),
    signal: AbortSignal.timeout(60000),
  });
  const estado = await leerJson<EstadoTrabajo & { error?: string }>(respuesta);
  if (!respuesta.ok || !estado?.id) {
    throw new Error(estado?.error || `No se pudo guardar el modelo (HTTP ${respuesta.status}).`);
  }
  return estado;
}

export async function adjuntarModeloSupabase(
  config: ConfigGemelo,
  id: string,
  glbUrl: string
): Promise<EstadoTrabajo> {
  const respuesta = await fetch(url(config, `/api/visor/trabajos/${id}/modelo`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ glb_url: glbUrl }),
    signal: AbortSignal.timeout(180000),
  });
  const estado = await leerJson<EstadoTrabajo & { error?: string }>(respuesta);
  if (!respuesta.ok || !estado?.id) {
    throw new Error(estado?.error || `No se pudo vincular el modelo (HTTP ${respuesta.status}).`);
  }
  return estado;
}

export async function obtenerEstadoSupabase(
  config: ConfigGemelo,
  id: string
): Promise<EstadoTrabajo> {
  const respuesta = await fetch(url(config, `/api/visor/trabajos/${id}`), {
    signal: AbortSignal.timeout(20000),
  });
  const estado = await leerJson<EstadoTrabajo & { error?: string }>(respuesta);
  if (!respuesta.ok || !estado?.id) {
    throw new Error(estado?.error || `Estado no disponible (${respuesta.status}).`);
  }
  return estado;
}

export async function cancelarTrabajoSupabase(config: ConfigGemelo, id: string): Promise<void> {
  try {
    await fetch(url(config, `/api/visor/trabajos/${id}`), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    void 0;
  }
}
