/**
 * Cliente del gemelo digital 3D.
 *
 * Habla con el worker de reconstrucción (server/) directamente desde el
 * navegador: sube fotos/video, consulta el estado y descarga el .glb.
 * La lógica de confianza/tiempos espeja la del worker (mantener sincronizada).
 */

export type ModoGemelo = 'auto' | 'colmap' | 'simular';

export interface ConfigGemelo {
  workerUrl: string;
  minFotos: number;
  maxFotos: number;
  maxVideoMb: number;
  modo: ModoGemelo;
}

export type EtapaTrabajo =
  | 'recibiendo'
  | 'extrayendo_frames'
  | 'reconstruyendo'
  | 'convirtiendo'
  | 'listo'
  | 'error';

export interface EstadoTrabajo {
  id: string;
  estado: 'pendiente' | 'recibiendo' | 'procesando' | 'listo' | 'error';
  etapa: EtapaTrabajo;
  progreso: number;
  mensaje: string | null;
  totalFotos: number;
  nFotos: number;
  esVideo: boolean;
  calidadEstimada: string | null;
  tiempoEstimadoSeg: number | null;
  modeloUrl: string | null;
  modeloBytes: number | null;
  error: string | null;
  motor: 'colmap' | 'simular' | null;
  creadoEn: number;
  expiraEn: number | null;
}

export interface CalidadInfo {
  clave: string;
  etiqueta: string;
  mensaje: string;
  nivel: number;
}

// ── Confianza según cantidad de fotos (espejo del worker) ────────────────────

export function calidadPorFotos(n: number): CalidadInfo {
  if (!Number.isFinite(n) || n <= 0) {
    return {
      clave: 'invalido',
      etiqueta: 'Sin fotos',
      mensaje: 'Subí fotos de la propiedad para generar el gemelo digital.',
      nivel: 0,
    };
  }
  if (n < 5) {
    return {
      clave: 'insuficiente',
      etiqueta: 'Insuficiente',
      mensaje: 'Se necesitan al menos 5 fotos para generar el gemelo digital.',
      nivel: 0,
    };
  }
  if (n <= 14) {
    return {
      clave: 'aproximado',
      etiqueta: 'Aproximado',
      mensaje:
        'Tu modelo 3D será aproximado: con 5–15 fotos la geometría se reconstruye de forma parcial. Sumá más fotos con buen solapamiento (cada zona en al menos 3 fotos).',
      nivel: 1,
    };
  }
  if (n <= 29) {
    return {
      clave: 'moderado',
      etiqueta: 'Moderado',
      mensaje:
        'Modelo 3D moderado: con 15–30 fotos vas a capturar la mayor parte de la geometría, aunque con algunas zonas imprecisas.',
      nivel: 2,
    };
  }
  if (n <= 59) {
    return {
      clave: 'bueno',
      etiqueta: 'Buena fidelidad',
      mensaje:
        'Buena fidelidad: con 30–60 fotos el modelo captura bien el espacio y los detalles principales.',
      nivel: 3,
    };
  }
  return {
    clave: 'alto',
    etiqueta: 'Alta fidelidad',
    mensaje:
      'Alta fidelidad: con más de 60 fotos podés lograr un gemelo digital detallado del inmueble.',
    nivel: 4,
  };
}

// ── Estimación de tiempos (espejo del worker) ────────────────────────────────

const PUNTOS: Array<[fotos: number, seg: number]> = [
  [5, 120],
  [20, 600],
  [50, 2400],
  [100, 5400],
];

function interpolar(fotos: number): number {
  if (fotos <= PUNTOS[0][0]) return PUNTOS[0][1];
  for (let i = 1; i < PUNTOS.length; i++) {
    const [fa, ta] = PUNTOS[i - 1];
    const [fb, tb] = PUNTOS[i];
    if (fotos <= fb) return Math.round(ta + ((fotos - fa) / (fb - fa)) * (tb - ta));
  }
  const [fa, ta] = PUNTOS[PUNTOS.length - 2];
  const [fb, tb] = PUNTOS[PUNTOS.length - 1];
  const pendiente = (tb - ta) / (fb - fa);
  return Math.round(tb + (fotos - fb) * pendiente);
}

export function tiempoEstimadoSeg(
  fotos: number,
  { esVideo = false, modo = 'colmap' }: { esVideo?: boolean; modo?: ModoGemelo } = {}
): number {
  const n = Math.max(1, Number(fotos) || 1);
  const efectivas = esVideo ? Math.max(n, 40) : n;
  if (modo === 'simular') return Math.round(15 + Math.min(efectivas, 60) * 2);
  return interpolar(efectivas);
}

export function formatearTiempo(seg: number): string {
  const s = Math.max(0, Math.round(seg || 0));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatearBytes(bytes: number | null): string {
  if (!bytes) return '';
  const unidades = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < unidades.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${unidades[i]}`;
}

// ── Configuración del servicio ───────────────────────────────────────────────

export interface ConexionWorker {
  ok: boolean;
  detalle: string;
}

/**
 * Ping al worker (/api/healthz) para diagnosticar conectividad antes de subir.
 */
export async function probarConexionWorker(config: ConfigGemelo): Promise<ConexionWorker> {
  try {
    const res = await fetch(`${config.workerUrl}/api/healthz`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, detalle: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, detalle: `worker ${data.modo} (COLMAP: ${data.colmapInstalado ? 'sí' : 'no'})` };
  } catch {
    return { ok: false, detalle: 'no responde' };
  }
}

export async function obtenerConfigGemelo(): Promise<ConfigGemelo | null> {
  try {
    const res = await fetch('/api/gemelo/config', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.workerUrl) return null;
    return {
      workerUrl: String(data.workerUrl).replace(/\/+$/, ''),
      minFotos: Number(data.minFotos) || 5,
      maxFotos: Number(data.maxFotos) || 100,
      maxVideoMb: Number(data.maxVideoMb) || 300,
      modo: (data.modo as ModoGemelo) || 'auto',
    };
  } catch {
    return null;
  }
}

// ── Subida de fotos con progreso (XMLHttpRequest) ────────────────────────────

export interface DatosSubida {
  titulo: string;
  idUsuario?: string | null;
  idPublicacion?: string | null;
  archivos: File[];
  calidad: 'rapida' | 'equilibrada' | 'alta' | 'auto';
  onProgreso?: (fraccion: number) => void;
}

export function subirTrabajo(config: ConfigGemelo, datos: DatosSubida): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('titulo', datos.titulo || 'Gemelo digital');
    if (datos.idUsuario) fd.append('id_usuario', datos.idUsuario);
    if (datos.idPublicacion) fd.append('id_publicacion', String(datos.idPublicacion));
    fd.append('opciones', JSON.stringify({ calidad: datos.calidad }));
    for (const f of datos.archivos) fd.append('fotos', f, f.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${config.workerUrl}/api/jobs`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && datos.onProgreso) datos.onProgreso(e.loaded / e.total);
    };
    xhr.onerror = () =>
      reject(
        new Error(
          `No se pudo conectar con el servicio de reconstrucción 3D (${config.workerUrl}/api/jobs). ` +
            'Verificá que el worker esté corriendo en el puerto correcto.'
        )
      );
    xhr.ontimeout = () =>
      reject(new Error('La subida superó el tiempo máximo. Probá con menos fotos o más livianas.'));
    xhr.timeout = 15 * 60 * 1000;
    xhr.onload = () => {
      let data: { id?: string; error?: string } | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data?.id) {
        resolve({ id: data.id });
      } else {
        reject(new Error(data?.error || `Error ${xhr.status} al crear el trabajo.`));
      }
    };
    xhr.send(fd);
  });
}

// ── Consultas al worker ──────────────────────────────────────────────────────

export async function obtenerEstadoTrabajo(config: ConfigGemelo, id: string): Promise<EstadoTrabajo> {
  const res = await fetch(`${config.workerUrl}/api/jobs/${id}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Estado no disponible (${res.status}).`);
  return (await res.json()) as EstadoTrabajo;
}

export function urlModelo(config: ConfigGemelo, job: Pick<EstadoTrabajo, 'modeloUrl'>): string | null {
  if (!job.modeloUrl) return null;
  if (/^https?:\/\//.test(job.modeloUrl)) return job.modeloUrl; // S3/B2 firmado
  return `${config.workerUrl}${job.modeloUrl}`;
}

export function urlDescarga(config: ConfigGemelo, job: Pick<EstadoTrabajo, 'modeloUrl'>): string | null {
  const base = urlModelo(config, job);
  return base ? `${base}${base.includes('?') ? '&' : '?'}download=1` : null;
}

export async function cancelarTrabajo(config: ConfigGemelo, id: string): Promise<void> {
  try {
    await fetch(`${config.workerUrl}/api/jobs/${id}`, { method: 'DELETE' });
  } catch {
    /* el worker puede no estar disponible; se ignora */
  }
}

// ── Historial local de trabajos (solo el navegador, no se guarda nada en BD) ─

export interface HistorialItem {
  id: string;
  titulo: string;
  creadoEn: number;
  calidad: string | null;
}

const HISTORIAL_KEY = 'sv_gemelo_historial';

export function guardarEnHistorial(item: HistorialItem): void {
  try {
    const actual = leerHistorial().filter((h) => h.id !== item.id);
    actual.unshift(item);
    localStorage.setItem(HISTORIAL_KEY, JSON.stringify(actual.slice(0, 10)));
  } catch {
    /* localStorage no disponible */
  }
}

export function leerHistorial(): HistorialItem[] {
  try {
    const raw = localStorage.getItem(HISTORIAL_KEY);
    return raw ? (JSON.parse(raw) as HistorialItem[]) : [];
  } catch {
    return [];
  }
}
