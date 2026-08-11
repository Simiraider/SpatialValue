import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, XCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import { cancelarTrabajo, formatearTiempo, obtenerEstadoTrabajo, type ConfigGemelo, type EstadoTrabajo, type EtapaTrabajo } from '../../lib/gemelo';

interface Props {
  config: ConfigGemelo;
  jobId: string;
  onListo: (job: EstadoTrabajo) => void;
  onCancelar: () => void;
}

const ORDEN: EtapaTrabajo[] = [
  'recibiendo',
  'extrayendo_frames',
  'reconstruyendo',
  'convirtiendo',
  'listo',
];

const PASOS: Record<string, { titulo: string; detalle: string }> = {
  recibiendo: { titulo: 'Subiendo fotos', detalle: 'Transfiriendo archivos al servicio de reconstrucción…' },
  extrayendo_frames: { titulo: 'Extrayendo cuadros', detalle: 'Convirtiendo el video en fotos (1 por segundo)…' },
  reconstruyendo: { titulo: 'Reconstruyendo en 3D', detalle: 'Estimando poses de cámara y generando la malla…' },
  convirtiendo: { titulo: 'Generando modelo .glb', detalle: 'Optimizando y texturizando el modelo…' },
  listo: { titulo: '¡Modelo listo!', detalle: 'Tu gemelo digital está disponible.' },
};

const FALLOS_MAXIMOS = 5;

export const BarraProgreso = ({ config, jobId, onListo, onCancelar }: Props) => {
  const [job, setJob] = useState<EstadoTrabajo | null>(null);
  const [fallos, setFallos] = useState(0);
  const [cancelando, setCancelando] = useState(false);
  const [detenido, setDetenido] = useState(false);
  const ejecutando = useRef(false);

  useEffect(() => {
    let activo = true;
    const poll = async () => {
      if (ejecutando.current) return;
      ejecutando.current = true;
      try {
        const estado = await obtenerEstadoTrabajo(config, jobId);
        if (!activo) return;
        setJob(estado);
        setFallos(0);
        if (estado.estado === 'listo') {
          onListo(estado);
        } else if (estado.estado === 'error') {
          setDetenido(true);
        }
      } catch {
        if (!activo) return;
        setFallos((f) => {
          const n = f + 1;
          if (n >= FALLOS_MAXIMOS) setDetenido(true);
          return n;
        });
      } finally {
        ejecutando.current = false;
      }
    };
    poll();
    const id = setInterval(poll, 2500);
    return () => {
      activo = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, jobId]);

  const etapa = job?.etapa || 'recibiendo';
  const idxActual = Math.max(0, ORDEN.indexOf(etapa));
  const progreso = job?.progreso ?? 0;
  const restanteSeg = job?.tiempoEstimadoSeg
    ? Math.max(0, Math.round(job.tiempoEstimadoSeg * (1 - progreso / 100)))
    : null;

  const cancelar = async () => {
    setCancelando(true);
    await cancelarTrabajo(config, jobId);
    onCancelar();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Generando tu gemelo digital</h2>
        <p className="mt-1 text-sm text-slate-500">
          El procesamiento puede tardar unos minutos. Podés cerrar esta página y volver más tarde.
        </p>
      </div>

      {/* Pasos */}
      <ol className="space-y-3">
        {PASOS_LIST.map(([clave], i) => {
          const completado = i < idxActual || etapa === 'listo';
          const activo = i === idxActual && etapa !== 'listo';
          const pasoActual = PASOS[clave];
          return (
            <li
              key={clave}
              className={cn(
                'flex items-start gap-3 rounded-2xl border px-4 py-3 transition-colors',
                completado && 'border-emerald-200 bg-emerald-50/60',
                activo && 'border-cyan-200 bg-cyan-50',
                !completado && !activo && 'border-slate-100 bg-slate-50 opacity-60'
              )}
            >
              {completado ? (
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <Check className="h-4 w-4" />
                </span>
              ) : activo ? (
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-500 text-white">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </span>
              ) : (
                <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full border-2 border-slate-200" />
              )}
              <div className="min-w-0">
                <p className={cn('text-sm font-semibold', activo ? 'text-cyan-800' : 'text-slate-700')}>
                  {pasoActual.titulo}
                </p>
                <p className="text-xs text-slate-500">{pasoActual.detalle}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Barra + mensaje vivo */}
      <div>
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="truncate font-medium text-slate-700">{job?.mensaje || 'Preparando…'}</span>
          <span className="shrink-0 pl-3 text-slate-500">{Math.round(progreso)}%</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-teal-500 transition-all duration-500"
            style={{ width: `${Math.max(2, progreso)}%` }}
          />
        </div>
        {restanteSeg !== null && etapa !== 'listo' && (
          <p className="mt-2 text-xs text-slate-500">
            Tiempo restante estimado: {formatearTiempo(restanteSeg)}
          </p>
        )}
      </div>

      {detenido && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="flex items-start gap-2 font-medium">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {job?.estado === 'error'
              ? job.error || 'El procesamiento falló.'
              : 'El servicio de reconstrucción no responde. Reintentá en un momento.'}
          </p>
          <div className="mt-3 flex gap-3">
            <Button type="button" variant="outline" size="sm" onClick={onCancelar}>
              Volver a subir
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDetenido(false);
                setFallos(0);
              }}
            >
              Reintentar
            </Button>
          </div>
        </div>
      )}

      {!detenido && (
        <button
          type="button"
          onClick={cancelar}
          disabled={cancelando}
          className="text-sm font-medium text-slate-400 underline-offset-4 hover:text-red-500 hover:underline disabled:opacity-50"
        >
          {cancelando ? 'Cancelando…' : 'Cancelar y borrar el trabajo'}
        </button>
      )}

      {fallos > 0 && !detenido && (
        <p className="flex items-center gap-2 text-xs text-amber-600">
          <AlertTriangle className="h-3.5 w-3.5" />
          El servicio está tardando en responder ({fallos} reintentos)…
        </p>
      )}
    </div>
  );
};

const PASOS_LIST = [
  ['recibiendo', PASOS.recibiendo],
  ['extrayendo_frames', PASOS.extrayendo_frames],
  ['reconstruyendo', PASOS.reconstruyendo],
  ['convirtiendo', PASOS.convirtiendo],
  ['listo', PASOS.listo],
] as const;
