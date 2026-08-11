import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw, ServerCrash } from 'lucide-react';
import { Button } from '../ui/Button';
import { SubidaFotos } from './SubidaFotos';
import { BarraProgreso } from './BarraProgreso';
import { Visor3D } from './Visor3D';
import {
  guardarEnHistorial,
  obtenerConfigGemelo,
  probarConexionWorker,
  type ConfigGemelo,
  type EstadoTrabajo,
} from '../../lib/gemelo';

interface Props {
  titulo?: string | null;
  propiedad?: string | null;
}

type Fase = 'cargando' | 'subir' | 'progreso' | 'visor' | 'sin-worker' | 'worker-fuera';

export const FlujoGemelo = ({ titulo, propiedad }: Props) => {
  const [fase, setFase] = useState<Fase>('cargando');
  const [config, setConfig] = useState<ConfigGemelo | null>(null);
  const [detalle, setDetalle] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<EstadoTrabajo | null>(null);

  useEffect(() => {
    let activo = true;
    (async () => {
      const c = await obtenerConfigGemelo();
      if (!activo) return;
      if (!c?.workerUrl) {
        setFase('sin-worker');
        return;
      }
      setConfig(c);
      // Diagnóstico: ¿el worker responde?
      const conn = await probarConexionWorker(c);
      if (!activo) return;
      if (conn.ok) {
        setFase('subir');
      } else {
        setDetalle(`No responde en ${c.workerUrl} (${conn.detalle}).`);
        setFase('worker-fuera');
      }
    })();
    return () => {
      activo = false;
    };
  }, []);

  const reintentar = async () => {
    if (!config) return;
    setFase('cargando');
    const conn = await probarConexionWorker(config);
    if (conn.ok) setFase('subir');
    else {
      setDetalle(`No responde en ${config.workerUrl} (${conn.detalle}).`);
      setFase('worker-fuera');
    }
  };

  const alCrearTrabajo = (id: string) => {
    setJobId(id);
    setFase('progreso');
  };

  const alListo = (j: EstadoTrabajo) => {
    setJob(j);
    setFase('visor');
    guardarEnHistorial({ id: j.id, titulo: j.titulo || 'Gemelo digital', creadoEn: j.creadoEn, calidad: j.calidadEstimada });
  };

  const reiniciar = () => {
    setJobId(null);
    setJob(null);
    setFase('subir');
  };

  if (fase === 'cargando') {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin text-cyan-600" />
        <span className="text-sm font-medium">Conectando con el servicio 3D…</span>
      </div>
    );
  }

  if (fase === 'worker-fuera' || fase === 'sin-worker') {
    const url = config?.workerUrl || 'sin definir';
    return (
      <div className="space-y-4 py-8 text-center">
        <ServerCrash className="mx-auto h-12 w-12 text-amber-500" />
        <h2 className="text-xl font-bold text-slate-800">
          {fase === 'sin-worker' ? 'Servicio 3D no configurado' : 'El worker 3D no responde'}
        </h2>
        <p className="mx-auto max-w-md text-sm text-slate-500">
          {fase === 'sin-worker' ? (
            <>
              Definí la variable{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold">
                PUBLIC_GEMELO_WORKER_URL
              </code>{' '}
              en <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold">.env.local</code>{' '}
              (ver <span className="font-medium">docs/DESPLIEGUE.md</span>).
            </>
          ) : (
            <>
              La URL configurada es{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold">{url}</code>{' '}
              y {detalle}
            </>
          )}
        </p>
        {fase === 'worker-fuera' && (
          <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left text-sm text-slate-600">
            <p className="font-semibold text-slate-800">Cómo arreglarlo:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>
                Asegurate de que la URL tenga <b>http://</b> y el puerto del worker (
                <b>4000</b>), no el del frontend (<b>4321</b>).
              </li>
              <li>
                En otra terminal, corré <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">cd server</code> y{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">npm start</code> (debe decir{' '}
                <i>"Gemelo worker escuchando en :4000"</i>).
              </li>
              <li>Reiniciá el dev server del frontend (Ctrl+C y volvé a correr npm run dev).</li>
            </ol>
          </div>
        )}
        <Button type="button" variant="secondary" onClick={reintentar}>
          <RefreshCw className="mr-2 h-4 w-4" /> Reintentar conexión
        </Button>
      </div>
    );
  }

  return (
    <div>
      {fase === 'subir' && (
        <SubidaFotos
          config={config!}
          tituloInicial={titulo || ''}
          propiedad={propiedad}
          onTrabajoCreado={alCrearTrabajo}
        />
      )}
      {fase === 'progreso' && jobId && (
        <BarraProgreso config={config!} jobId={jobId} onListo={alListo} onCancelar={reiniciar} />
      )}
      {fase === 'visor' && job && <Visor3D config={config!} job={job} onNuevo={reiniciar} />}
    </div>
  );
};

