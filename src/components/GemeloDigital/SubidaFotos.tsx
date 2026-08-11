import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, Film, Loader2, Trash2, UploadCloud, Video } from 'lucide-react';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import { getUsuarioId } from '../../lib/session';
import {
  calidadPorFotos,
  formatearTiempo,
  subirTrabajo,
  tiempoEstimadoSeg,
  type ConfigGemelo,
} from '../../lib/gemelo';
import { AvisoConfianza } from './AvisoConfianza';

interface Props {
  config: ConfigGemelo;
  tituloInicial?: string;
  propiedad?: string | null;
  onTrabajoCreado: (id: string) => void;
}

const esImagen = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|avif)$/i.test(f.name);
const esVideo = (f: File) =>
  ['video/mp4', 'video/quicktime', 'video/webm'].includes(f.type) ||
  /\.(mp4|mov|m4v|webm)$/i.test(f.name);

export const SubidaFotos = ({ config, tituloInicial = '', propiedad, onTrabajoCreado }: Props) => {
  const [archivos, setArchivos] = useState<File[]>([]);
  const [titulo, setTitulo] = useState(tituloInicial);
  const [calidad, setCalidad] = useState<'rapida' | 'equilibrada' | 'alta'>('equilibrada');
  const [dragging, setDragging] = useState(false);
  const [subiendo, setSubiendo] = useState<number | null>(null); // 0..1
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const esVideoSubido = archivos.some(esVideo);

  // Limpia los object URLs al desmontar.
  useEffect(() => {
    return () => {
      Object.values(previews).forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agregarArchivos = (lista: FileList | File[]) => {
    const invalidos: string[] = [];
    const pesados: string[] = [];
    const validos = Array.from(lista).filter((f) => {
      if (esImagen(f) || esVideo(f)) return true;
      invalidos.push(f.name);
      return false;
    });
    const conTamaño = validos.filter((f) => {
      if (f.size > config.maxVideoMb * 1024 * 1024) {
        pesados.push(f.name);
        return false;
      }
      return true;
    });
    const errores: string[] = [];
    if (invalidos.length) {
      errores.push(
        `Formato no soportado: ${invalidos.join(', ')}. Usá fotos JPG/PNG/HEIC o un video MP4/MOV.`
      );
    }
    if (pesados.length) {
      errores.push(`Superan el máximo de ${config.maxVideoMb} MB por archivo: ${pesados.join(', ')}.`);
    }
    setError(errores.length ? errores.join(' ') : null);
    setArchivos((prev) => {
      const juntos = [...prev, ...conTamaño];
      // Evita duplicados por nombre+tamaño.
      const unicos = juntos.filter(
        (f, i) => juntos.findIndex((g) => g.name === f.name && g.size === f.size) === i
      );
      return unicos.slice(0, config.maxFotos);
    });
    // Crea previews para imágenes nuevas.
    for (const f of conTamaño) {
      if (esImagen(f)) {
        const url = URL.createObjectURL(f);
        setPreviews((prev) => ({ ...prev, [`${f.name}-${f.size}`]: url }));
      }
    }
  };

  const quitar = (idx: number) => {
    setArchivos((prev) => prev.filter((_, i) => i !== idx));
  };

  const fotos = archivos.filter(esImagen).length;
  const videoOk = esVideoSubido;
  const puedeGenerar = (fotos >= config.minFotos || videoOk) && archivos.length > 0;

  const info = useMemo(() => calidadPorFotos(fotos), [fotos]);
  const estimadoSeg = useMemo(
    () =>
      tiempoEstimadoSeg(videoOk ? 1 : fotos, {
        esVideo: videoOk,
        modo: config.modo === 'simular' ? 'simular' : 'colmap',
      }),
    [fotos, videoOk, config.modo]
  );

  const generar = async () => {
    if (!puedeGenerar || subiendo !== null) return;
    setError(null);
    setSubiendo(0);
    try {
      const usuarioId = getUsuarioId() || undefined;
      const { id } = await subirTrabajo(config, {
        titulo: titulo.trim() || 'Gemelo digital',
        idUsuario: usuarioId,
        idPublicacion: propiedad || undefined,
        archivos,
        calidad,
        onProgreso: (f) => setSubiendo(f),
      });
      onTrabajoCreado(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el gemelo digital.');
      setSubiendo(null);
    }
  };

  const mensajeLimite = !esVideoSubido && fotos < config.minFotos;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Gemelo digital 3D</h2>
        <p className="mt-1 text-sm text-slate-500">
          Subí fotos de la propiedad (o un video) y generamos una réplica 3D interactiva con
          fotogrametría. Las fotos no se guardan: se procesan y se descartan.
        </p>
      </div>

      <div className="flex flex-col space-y-1.5 w-full">
        <label className="text-sm font-medium text-slate-700 ml-1">Título de la propiedad</label>
        <input
          className="flex h-12 w-full rounded-2xl bg-white px-4 py-2 text-base shadow-sm transition-colors placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 border-0"
          placeholder="Ej. Departamento en Palermo"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          maxLength={200}
        />
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          agregarArchivos(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'cursor-pointer rounded-3xl border-2 border-dashed p-8 text-center transition-all',
          dragging
            ? 'border-cyan-500 bg-cyan-50 scale-[1.01]'
            : 'border-slate-200 bg-slate-50 hover:border-cyan-400 hover:bg-cyan-50/50'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.mp4,.mov,.m4v,.webm"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) agregarArchivos(e.target.files);
            e.target.value = '';
          }}
        />
        <UploadCloud className="mx-auto h-10 w-10 text-cyan-600" />
        <p className="mt-3 text-sm font-semibold text-slate-700">
          Arrastrá fotos o un video acá
        </p>
        <p className="mt-1 text-xs text-slate-500">
          o hacé clic para elegir archivos · JPG, PNG, HEIC, MP4, MOV · máx {config.maxFotos} archivos
        </p>
        <p className="mt-2 text-xs text-slate-400">
          Consejo: recorré cada ambiente y que cada zona aparezca en al menos 3 fotos.
        </p>
      </div>

      {/* Previews */}
      {archivos.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">
              {archivos.length} archivo{archivos.length !== 1 ? 's' : ''} ·{' '}
              {esVideoSubido ? '1 video' : `${fotos} fotos`}
            </p>
            <button
              type="button"
              onClick={() => {
                setArchivos([]);
                setError(null);
              }}
              className="text-xs font-medium text-slate-400 hover:text-red-500 transition-colors"
            >
              Quitar todos
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {archivos.map((f, i) => {
              const url = previews[`${f.name}-${f.size}`];
              return (
                <div key={`${f.name}-${f.size}-${i}`} className="group relative aspect-square overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                  {url ? (
                    <img src={url} alt={f.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      {esVideo(f) ? (
                        <Film className="h-8 w-8 text-slate-400" />
                      ) : (
                        <Camera className="h-8 w-8 text-slate-400" />
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      quitar(i);
                    }}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label={`Quitar ${f.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  {esVideo(f) && (
                    <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      <Video className="mr-0.5 inline h-3 w-3" /> video
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Confianza + tiempos */}
      {archivos.length > 0 && (
        <div className="space-y-3">
          <AvisoConfianza fotos={fotos} esVideo={esVideoSubido} />
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-slate-700">Calidad de reconstrucción</span>
              <select
                value={calidad}
                onChange={(e) => setCalidad(e.target.value as typeof calidad)}
                className="h-10 rounded-xl bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 border-0"
              >
                <option value="rapida">Rápida</option>
                <option value="equilibrada">Equilibrada</option>
                <option value="alta">Alta</option>
              </select>
            </div>
            <p className="text-sm text-slate-600">
              Tiempo estimado: <span className="font-semibold text-slate-800">{formatearTiempo(estimadoSeg)}</span>
            </p>
          </div>
        </div>
      )}

      {mensajeLimite && (
        <p className="flex items-center gap-2 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4" />
          Se necesitan al menos {config.minFotos} fotos (o un video) para generar el gemelo digital.
          Tenés {fotos}.
        </p>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {subiendo !== null && (
        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-medium text-slate-700">
              <Loader2 className="h-4 w-4 animate-spin" /> Subiendo fotos al servicio 3D…
            </span>
            <span className="text-slate-500">{Math.round(subiendo * 100)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-cyan-500 transition-all"
              style={{ width: `${subiendo * 100}%` }}
            />
          </div>
        </div>
      )}

      <Button
        type="button"
        variant="secondary"
        size="lg"
        fullWidth
        disabled={!puedeGenerar || subiendo !== null}
        isLoading={subiendo !== null}
        onClick={generar}
      >
        {subiendo !== null ? 'Subiendo…' : 'Generar gemelo digital'}
      </Button>
      <p className="text-center text-xs text-slate-400">
        {info.clave === 'insuficiente' || info.clave === 'invalido'
          ? 'Completá la subida para habilitar el botón.'
          : `Fidelidad estimada: ${info.etiqueta}. Esto es un prototipo: la precisión mejora con más fotos y mejores condiciones.`}
      </p>
    </div>
  );
};
