import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Loader2, RefreshCw, Rotate3D, LayoutDashboard } from 'lucide-react';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import { formatearBytes, urlDescarga, urlModelo, type ConfigGemelo, type EstadoTrabajo } from '../../lib/gemelo';

interface Props {
  config: ConfigGemelo;
  job: EstadoTrabajo;
  onNuevo: () => void;
}

declare global {
  interface HTMLElementTagNameMap {
    'model-viewer': HTMLElement & {
      src: string;
      alt: string;
      autoRotate: boolean;
      cameraControls: boolean;
      shadowIntensity: string;
      exposure: string;
      cameraOrbit: string;
      setAttribute(name: string, value: string): void;
      removeAttribute(name: string): void;
    };
  }
}

export const Visor3D = ({ config, job, onNuevo }: Props) => {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRotar, setAutoRotar] = useState(true);

  const modelo = urlModelo(config, job);

  useEffect(() => {
    let desmontado = false;
    let visor: HTMLElement | null = null;
    let cancelar = () => {};

    (async () => {
      try {
        // Se importa el build precompilado del paquete (autocontenido) porque
        // la entrada por defecto (lib/model-viewer.js) puede romperse con Vite 7.
        await import('@google/model-viewer/dist/model-viewer-module.min.js');
        if (desmontado || !contenedorRef.current) return;
        visor = document.createElement('model-viewer');
        visor.setAttribute('src', modelo || '');
        visor.setAttribute('alt', 'Gemelo digital de la propiedad');
        visor.setAttribute('camera-controls', '');
        visor.setAttribute('auto-rotate', '');
        visor.setAttribute('shadow-intensity', '1');
        visor.setAttribute('environment-image', 'neutral');
        visor.setAttribute('ar', '');
        visor.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
        visor.style.width = '100%';
        visor.style.height = '100%';
        visor.addEventListener('load', () => !desmontado && setCargando(false));
        visor.addEventListener('error', () =>
          !desmontado && setError('No se pudo cargar el modelo 3D. Probá descargarlo directamente.')
        );
        contenedorRef.current.appendChild(visor);
      } catch (e) {
        if (!desmontado) {
          setError(
            `No se pudo inicializar el visor 3D: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    })();

    cancelar = () => {
      desmontado = true;
      visor?.remove();
    };
    return cancelar;
  }, [modelo]);

  const toggleRotacion = useCallback(() => {
    setAutoRotar((prev) => {
      const visor = contenedorRef.current?.querySelector('model-viewer');
      if (visor) {
        if (prev) visor.removeAttribute('auto-rotate');
        else visor.setAttribute('auto-rotate', '');
      }
      return !prev;
    });
  }, []);

  const descarga = urlDescarga(config, job);
  const horasRestantes = job.expiraEn
    ? Math.max(1, Math.ceil((job.expiraEn - Date.now()) / 3600000))
    : 1;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Tu gemelo digital</h2>
        <p className="mt-1 text-sm text-slate-500">
          {job.titulo || 'Modelo de la propiedad'} ·{' '}
          {job.motor === 'simular' ? 'modelo de demostración' : `modelo ${job.totalFotos} fotos`}
          {job.modeloBytes ? ` · ${formatearBytes(job.modeloBytes)}` : ''}
        </p>
      </div>

      <div className="relative h-[26rem] w-full overflow-hidden rounded-3xl border border-slate-200 bg-slate-100">
        <div ref={contenedorRef} className="h-full w-full" />
        {cargando && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-50/90 text-slate-500">
            <Loader2 className="h-8 w-8 animate-spin text-cyan-600" />
            <span className="text-sm font-medium">Cargando modelo 3D…</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-50/95 px-6 text-center">
            <p className="text-sm font-medium text-red-600">{error}</p>
            {descarga && (
              <a
                href={descarga}
                className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                <Download className="h-4 w-4" /> Descargar .glb
              </a>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={toggleRotacion}>
            <Rotate3D className="mr-1.5 h-4 w-4" />
            {autoRotar ? 'Detener rotación' : 'Auto-rotar'}
          </Button>
          {descarga && (
            <a href={descarga} download="gemelo-digital.glb">
              <Button type="button" variant="secondary" size="sm">
                <Download className="mr-1.5 h-4 w-4" /> Descargar .glb
              </Button>
            </a>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onNuevo}>
            <RefreshCw className="mr-1.5 h-4 w-4" /> Generar otro
          </Button>
          <a href="/dashboard">
            <Button type="button" variant="ghost" size="sm">
              <LayoutDashboard className="mr-1.5 h-4 w-4" /> Dashboard
            </Button>
          </a>
        </div>
      </div>

      {job.motor === 'simular' && job.mensaje?.includes('COLMAP') && (
        <p className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-relaxed text-sky-800">
          ℹ️ {job.mensaje}
        </p>
      )}
      <p className={cn('rounded-2xl border px-4 py-3 text-xs leading-relaxed', 'border-amber-200 bg-amber-50 text-amber-800')}>
        ⚠️ Esto es un prototipo: la precisión del modelo mejora con más fotos, buen solapamiento y
        mejores condiciones de luz. El modelo se elimina automáticamente en {horasRestantes} h y tus
        fotos no se guardan.
      </p>
    </div>
  );
};
