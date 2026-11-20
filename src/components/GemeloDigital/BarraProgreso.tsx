import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, XCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import { cancelarTrabajo, formatearTiempo, obtenerEstadoTrabajo, type ConfigGemelo, type EstadoTrabajo, type EtapaTrabajo } from '../../lib/gemelo';
import {
  adjuntarModeloSupabase,
  cancelarTrabajoSupabase,
  enviarAKiriSupabase,
  obtenerEstadoSupabase,
  subirModeloGLBSupabase,
  visorEnSupabase,
} from '../../lib/visor-supabase';

interface Props {
  config: ConfigGemelo;
  jobId: string;
  propiedad?: string | null;
  onListo: (job: EstadoTrabajo) => void;
  onCancelar: () => void;
}

const ORDEN: EtapaTrabajo[] = ['recibiendo', 'reconstruyendo', 'convirtiendo', 'listo'];

const PASOS: Record<string, { titulo: string; detalle: string }> = {
  recibiendo: { titulo: 'Subiendo fotos', detalle: 'Transfiriendo archivos al servicio de reconstrucción…' },
  reconstruyendo: {
    titulo: 'Reconstruyendo con MASt3R',
    detalle: 'MASt3R estima las cámaras y arma la nube de puntos en una GPU pública: puede esperar en cola.',
  },
  convirtiendo: { titulo: 'Generando modelo .glb', detalle: 'Descargando y guardando el modelo generado…' },
  listo: { titulo: '¡Modelo listo!', detalle: 'Tu gemelo digital está disponible.' },
};

const FALLOS_MAXIMOS = 5;
const SIN_SENAL_ALERTA_SEG = 45;
const POLLS_PARA_REENVIAR = 3;
export const LIMITE_DEMO_SEG = 10 * 60;

function reloj(seg: number): string {
  const total = Math.max(0, Math.round(seg || 0));
  const min = Math.floor(total / 60);
  const resto = total % 60;
  return min ? `${min}:${String(resto).padStart(2, '0')}` : `${total} s`;
}

export const BarraProgreso = ({ config, jobId, propiedad = null, onListo, onCancelar }: Props) => {
  const [job, setJob] = useState<EstadoTrabajo | null>(null);
  const [fallos, setFallos] = useState(0);
  const [cancelando, setCancelando] = useState(false);
  const [detenido, setDetenido] = useState(false);
  const [glbUrl, setGlbUrl] = useState('');
  const [archivoGlb, setArchivoGlb] = useState<File | null>(null);
  const [vinculando, setVinculando] = useState(false);
  const [errorVinculo, setErrorVinculo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const [senalLocal, setSenalLocal] = useState(() => Date.now());
  const [consultaOk, setConsultaOk] = useState(true);
  const ejecutando = useRef(false);
  const pendientes = useRef(0);
  const autoEnviado = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const firma = job ? `${job.etapa}|${job.progreso}|${job.mensaje || ''}` : '';

  useEffect(() => {
    if (firma) setSenalLocal(Date.now());
  }, [firma]);

  useEffect(() => {
    let activo = true;
    const poll = async () => {
      if (ejecutando.current) return;
      ejecutando.current = true;
      try {
        const estado = visorEnSupabase(config)
          ? await obtenerEstadoSupabase(config, jobId)
          : await obtenerEstadoTrabajo(config, jobId);
        if (!activo) return;
        setJob(estado);
        setFallos(0);
        setConsultaOk(true);
        if (estado.estado === 'listo') {
          onListo(estado);
        } else if (estado.estado === 'error') {
          setDetenido(true);
        } else if (estado.estado === 'pendiente') {
          pendientes.current += 1;
          if (pendientes.current >= POLLS_PARA_REENVIAR && !autoEnviado.current) {
            autoEnviado.current = true;
            void enviarAKiri();
          }
        } else {
          pendientes.current = 0;
        }
      } catch {
        if (!activo) return;
        setConsultaOk(false);
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
  }, [config, jobId]);

  const etapa = job?.etapa || 'recibiendo';
  const idxActual = Math.max(0, ORDEN.indexOf(etapa));
  const progreso = job?.progreso ?? 0;
  const restanteSeg = job?.tiempoEstimadoSeg
    ? Math.max(0, Math.round(job.tiempoEstimadoSeg * (1 - progreso / 100)))
    : null;
  const transcurridoSeg = job?.creadoEn ? Math.max(0, Math.floor((ahora - job.creadoEn) / 1000)) : 0;
  const pasadoElLimite = transcurridoSeg >= LIMITE_DEMO_SEG;

  const ultimaSenal = Math.max(senalLocal, job?.latidoEn || 0);
  const sinSenalSeg = Math.max(0, Math.floor((ahora - ultimaSenal) / 1000));
  const sinSenal = Boolean(job) && etapa !== 'listo' && sinSenalSeg >= SIN_SENAL_ALERTA_SEG;

  const cancelar = async () => {
    setCancelando(true);
    if (visorEnSupabase(config)) await cancelarTrabajoSupabase(config, jobId);
    else await cancelarTrabajo(config, jobId);
    onCancelar();
  };

  const vincularUrl = async () => {
    if (!glbUrl.trim() || vinculando) return;
    setVinculando(true);
    setErrorVinculo(null);
    try {
      const listo = await adjuntarModeloSupabase(config, jobId, glbUrl.trim());
      setJob(listo);
      onListo(listo);
    } catch (e) {
      setErrorVinculo(e instanceof Error ? e.message : 'No se pudo vincular el modelo.');
    } finally {
      setVinculando(false);
    }
  };

  const subirGlb = async () => {
    if (!archivoGlb || vinculando) return;
    setVinculando(true);
    setErrorVinculo(null);
    try {
      const listo = await subirModeloGLBSupabase(config, {
        titulo: job?.titulo || 'Gemelo digital',
        idPublicacion: propiedad,
        archivo: archivoGlb,
      });
      setJob(listo);
      setArchivoGlb(null);
      onListo(listo);
    } catch (e) {
      setErrorVinculo(e instanceof Error ? e.message : 'No se pudo subir el modelo.');
    } finally {
      setVinculando(false);
    }
  };

  const enviarAKiri = async () => {
    if (enviando) return;
    setEnviando(true);
    setErrorEnvio(null);
    setDetenido(false);
    setFallos(0);
    try {
      const estado = await enviarAKiriSupabase(config, jobId);
      if (!estado) return;
      setJob(estado);
      if (estado.estado === 'listo') onListo(estado);
      if (estado.estado === 'error') setDetenido(true);
    } catch (e) {
      setErrorEnvio(
        e instanceof Error ? e.message : 'No se pudo iniciar el procesamiento 3D.'
      );
    } finally {
      setEnviando(false);
    }
  };

  const reintentar = () => {
    setDetenido(false);
    setFallos(0);
    autoEnviado.current = false;
    pendientes.current = 0;
    if (job?.estado === 'error' || job?.estado === 'pendiente') void enviarAKiri();
  };

  const esperandoModelo = visorEnSupabase(config) && job?.estado === 'pendiente';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Generando tu gemelo digital</h2>
        <p className="mt-1 text-sm text-slate-500">
          El procesamiento puede tardar unos minutos. Podés cerrar esta página y volver más tarde.
        </p>
      </div>

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

      <div>
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="truncate font-medium text-slate-700">
            {job?.mensaje || (job ? 'Preparando…' : 'Consultando el estado del trabajo…')}
          </span>
          <span className="shrink-0 pl-3 text-slate-500">{job ? `${Math.round(progreso)}%` : '—'}</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          {sinSenal ? (
            <div className="h-full w-full animate-pulse bg-cyan-200" />
          ) : (
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-teal-500 transition-all duration-500"
              style={{ width: `${Math.max(2, progreso)}%` }}
            />
          )}
        </div>
        {restanteSeg !== null && etapa !== 'listo' && (
          <p className="mt-2 text-xs text-slate-500">
            Tiempo restante estimado: {formatearTiempo(restanteSeg)}
          </p>
        )}
      </div>

      {job && etapa !== 'listo' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="relative flex h-2 w-2">
              <span
                className={cn(
                  'absolute inline-flex h-full w-full rounded-full opacity-75',
                  sinSenal ? 'bg-amber-400' : 'animate-ping bg-emerald-400'
                )}
              />
              <span
                className={cn(
                  'relative inline-flex h-2 w-2 rounded-full',
                  sinSenal ? 'bg-amber-500' : 'bg-emerald-500'
                )}
              />
            </span>
            <span className="font-medium text-slate-700">
              {sinSenal ? 'Sin novedades' : 'Trabajando'} hace {reloj(transcurridoSeg)}
            </span>
            <span className="text-slate-400">·</span>
            <span className={sinSenal ? 'font-medium text-amber-600' : 'text-slate-500'}>
              {sinSenal
                ? `última señal hace ${reloj(sinSenalSeg)}`
                : `última señal del servidor hace ${reloj(sinSenalSeg)}`}
            </span>
          </div>

          {pasadoElLimite && !detenido && (
            <p className="text-xs font-medium text-amber-600">
              Pasaron más de 10 minutos de procesamiento: te mostramos el modelo de demostración.
            </p>
          )}

          {sinSenal && !detenido && (
            <p className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                El servidor no reporta avances hace {reloj(sinSenalSeg)}. El trabajo puede seguir
                esperando turno en la GPU de MASt3R; si se cumplen los 10 minutos te mostramos el
                modelo de demostración.
              </span>
            </p>
          )}
        </div>
      )}

      {esperandoModelo && (
        <div className="space-y-3 rounded-2xl border border-cyan-200 bg-cyan-50/70 px-4 py-4">
          <div>
            <p className="text-sm font-semibold text-cyan-900">El material ya está en Supabase</p>
            <p className="mt-1 text-xs leading-relaxed text-cyan-800">
              Falta el modelo final para verlo en 3D. Mandá el material al motor 3D o vinculá un
              .glb ya generado.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              isLoading={enviando}
              disabled={enviando || vinculando}
              onClick={enviarAKiri}
            >
              Enviar al motor 3D
            </Button>
            <span className="text-xs text-cyan-800">también podés vincularlo a mano:</span>
          </div>
          {errorEnvio && <p className="text-xs font-medium text-red-600">{errorEnvio}</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              value={glbUrl}
              onChange={(e) => setGlbUrl(e.target.value)}
              placeholder="https://…/modelo.glb"
              className="h-10 flex-1 rounded-2xl border-0 bg-white px-4 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
            />
            <Button
              type="button"
              size="sm"
              disabled={!glbUrl.trim() || vinculando}
              isLoading={vinculando}
              onClick={vincularUrl}
            >
              Vincular enlace
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept=".glb,model/gltf-binary"
              onChange={(e) => {
                setArchivoGlb(e.target.files?.[0] || null);
                setErrorVinculo(null);
                e.target.value = '';
              }}
              className="text-xs text-slate-600"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!archivoGlb || vinculando}
              onClick={subirGlb}
            >
              Subir .glb
            </Button>
          </div>
          {errorVinculo && <p className="text-xs font-medium text-red-600">{errorVinculo}</p>}
        </div>
      )}

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
            <Button type="button" variant="ghost" size="sm" onClick={reintentar}>
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
          {consultaOk
            ? 'El servicio está tardando en responder…'
            : `No pudimos consultar el estado (${fallos} reintentos)…`}
        </p>
      )}
    </div>
  );
};

const PASOS_LIST = [
  ['recibiendo', PASOS.recibiendo],
  ['reconstruyendo', PASOS.reconstruyendo],
  ['convirtiendo', PASOS.convirtiendo],
  ['listo', PASOS.listo],
] as const;
