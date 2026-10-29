import React, { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Box, Building2, Camera, Check, Home, KeyRound, Loader2, TrendingUp, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { navegarA, esIdSeguro } from '../lib/navigate';
import { apiFetch } from '../lib/api';
import { getUsuarioId } from '../lib/session';
import { BARRIOS_CABA } from '../lib/mercado';
import { cn } from '../lib/utils';
import {
  obtenerConfigGemelo,
  probarConexionWorker,
  subirModeloExterno,
  type ConfigGemelo,
  type EstadoTrabajo,
} from '../lib/gemelo';
import { subirModeloGLBSupabase, visorEnSupabase } from '../lib/visor-supabase';
import { SubidaFotos } from './GemeloDigital/SubidaFotos';
import { BarraProgreso } from './GemeloDigital/BarraProgreso';
import { Visor3D } from './GemeloDigital/Visor3D';

const TOTAL_STEPS = 4;
const PASOS = ['Ubicación', 'Características', 'Extras', 'Fotos'];
const AMENITIES = ['Seguridad 24h', 'Ascensor', 'Cochera', 'Gimnasio', 'Baulera', 'Cámaras', 'Balcón', 'Lounge', 'Terraza', 'Pileta', 'Patio', 'Parrilla', 'Laundry'];
const OPCIONES_LUZ = ['Abundante', 'Buena', 'Media', 'Poca'];
const AMBIENTES_3D = ['Living/comedor', 'Cocina', 'Dormitorio', 'Baño', 'Oficina', 'Exterior/patio', 'Otro'];
const EDICION_KEY = 'tasacion-edicion';
const DRAFT_KEY = 'tasacion-draft';

type FormData = {
  tipoTasacion: 'venta' | 'alquiler'; direccion: string; barrio: string;
  tipoUnidad: 'Casa' | 'Departamento'; superficieTotal: string; superficieCubierta: string;
  ambientes: string; antiguedad: string; banos: string; dormitorios: string; piso: string;
  orientacion: string; disposicion: string; luzNatural: string; comodidades: string[]; estadoGeneral: number; expensas: string;
};

type FotoGuardada = { name: string; size: number; type: string };

type TasacionDraft = {
  id?: string | number;
  tipoTasacion?: 'venta' | 'alquiler';
  tipo_operacion?: string;
  direccion?: string;
  barrio?: string | null;
  tipoUnidad?: string;
  superficieTotal?: string | number;
  superficieCubierta?: string | number;
  superficieDescubierta?: number;
  ambientes?: string | number;
  antiguedad?: string | number | null;
  banos?: string | number;
  dormitorios?: string | number;
  piso?: string | number;
  orientacion?: string | null;
  disposicion?: string | null;
  luzNatural?: string | null;
  comodidades?: string[];
  estadoGeneral?: number;
  expensas?: string | number;
  fotos?: FotoGuardada[];
  modelo3d?: { jobId: string; motor?: string | null; bytes?: number | null } | null;
  precioEstimadoUsd?: number | null;
  coordenadas?: { lat: number; lng: number } | null;
  demo?: boolean;
  es_borrador?: boolean;
  edicion?: boolean;
};

type VerificacionDireccion = {
  estado: 'idle' | 'verificando' | 'invalida' | 'barrio-distinto' | 'ok' | 'sin-servicio';
  mensaje?: string;
  sugerencia?: string | null;
};

const initialData: FormData = {
  tipoTasacion: 'venta', direccion: '', barrio: '', tipoUnidad: 'Departamento',
  superficieTotal: '', superficieCubierta: '', ambientes: '3', antiguedad: '', banos: '1', dormitorios: '1',
  piso: '0', orientacion: '', disposicion: '', luzNatural: '', comodidades: [], estadoGeneral: 7, expensas: '',
};

const texto = (v: unknown): string => (v == null ? '' : String(v).trim());

const clampEstado = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return initialData.estadoGeneral;
  return Math.min(Math.max(Math.round(n), 1), 10);
};

function leerEdicion(): TasacionDraft | null {
  try {
    const raw = sessionStorage.getItem(EDICION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TasacionDraft;
    if (!parsed || typeof parsed !== 'object' || parsed.edicion !== true) return null;
    const id = parsed.id == null ? '' : String(parsed.id);
    if (!id || !esIdSeguro(id)) return null;
    return { ...parsed, id };
  } catch {
    return null;
  }
}

function precargarDesdeEdicion(draft: TasacionDraft): FormData {
  const supCub = texto(draft.superficieCubierta);
  return {
    tipoTasacion: draft.tipoTasacion ?? (draft.tipo_operacion === 'alquiler' ? 'alquiler' : 'venta'),
    direccion: texto(draft.direccion),
    barrio: texto(draft.barrio),
    tipoUnidad: draft.tipoUnidad === 'Casa' ? 'Casa' : 'Departamento',
    superficieTotal: texto(draft.superficieTotal) || supCub,
    superficieCubierta: supCub,
    ambientes: texto(draft.ambientes) || initialData.ambientes,
    antiguedad: draft.antiguedad == null ? '' : texto(draft.antiguedad),
    banos: texto(draft.banos) || initialData.banos,
    dormitorios: texto(draft.dormitorios) || initialData.dormitorios,
    piso: texto(draft.piso) || initialData.piso,
    orientacion: texto(draft.orientacion),
    disposicion: texto(draft.disposicion),
    luzNatural: texto(draft.luzNatural),
    comodidades: Array.isArray(draft.comodidades) ? draft.comodidades.filter(a => AMENITIES.includes(a)) : [],
    estadoGeneral: clampEstado(draft.estadoGeneral),
    expensas: texto(draft.expensas),
  };
}

function Selector({ label, value, onChange, placeholder, opciones, error }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; opciones: string[]; error?: string }) {
  const [abierto, setAbierto] = useState(false);
  const cajaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const cerrarFuera = (evento: MouseEvent) => {
      if (cajaRef.current && !cajaRef.current.contains(evento.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', cerrarFuera);
    return () => document.removeEventListener('mousedown', cerrarFuera);
  }, [abierto]);

  return <div className="tasacion__campo" ref={cajaRef}>
    <span className="tasacion__etiqueta">{label}</span>
    <button
      type="button"
      aria-haspopup="listbox"
      aria-expanded={abierto}
      onClick={() => setAbierto(prev => !prev)}
      className={cn('tasacion__selector', error && 'tasacion__selector--invalido')}
    >
      <span className={cn('tasacion__selector-valor', !value && 'tasacion__selector-valor--placeholder')}>{value || placeholder}</span>
      <svg className={cn('tasacion__selector-flecha', abierto && 'tasacion__selector-flecha--arriba')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {abierto && (
      <ul className="tasacion__selector-opciones" role="listbox" aria-label={label}>
        <li>
          <button type="button" className="tasacion__selector-opcion tasacion__selector-opcion--placeholder" onClick={() => { onChange(''); setAbierto(false); }}>
            {placeholder}
          </button>
        </li>
        {opciones.map(op => (
          <li key={op}>
            <button
              type="button"
              role="option"
              aria-selected={value === op}
              className={cn('tasacion__selector-opcion', value === op && 'tasacion__selector-opcion--activa')}
              onClick={() => { onChange(op); setAbierto(false); }}
            >
              {op}
              {value === op && <Check className="tasacion__selector-check" aria-hidden />}
            </button>
          </li>
        ))}
      </ul>
    )}
    {error && <p className="tasacion__error">{error}</p>}
  </div>;
}

function TarjetaEleccion({ icono: Icono, titulo, activo, onClick }: { icono: LucideIcon; titulo: string; activo: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn('tasacion__eleccion-card', activo && 'tasacion__eleccion-card--activa')}
    >
      <Icono className="tasacion__eleccion-icono" aria-hidden />
      <span>{titulo}</span>
    </button>
  );
}

export const PropertyForm = () => {
  const edicion = useMemo(leerEdicion, []);
  const [step, setStep] = useState(1);
  const [data, setData] = useState<FormData>(() => (edicion ? precargarDesdeEdicion(edicion) : initialData));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [showSlider, setShowSlider] = useState(false);
  const [guardarComoBorrador, setGuardarComoBorrador] = useState(false);
  const [verifDir, setVerifDir] = useState<VerificacionDireccion>({ estado: 'idle' });
  const [arrastrando, setArrastrando] = useState(false);
  const [quiereModelo3d, setQuiereModelo3d] = useState(false);
  const [gemeloFase, setGemeloFase] = useState<'sin-usar' | 'conectando' | 'subir' | 'progreso' | 'listo' | 'sin-worker'>('sin-usar');
  const [gemeloConfig, setGemeloConfig] = useState<ConfigGemelo | null>(null);
  const [gemeloJobId, setGemeloJobId] = useState<string | null>(null);
  const [gemeloJob, setGemeloJob] = useState<EstadoTrabajo | null>(null);
  const [modoSubida, setModoSubida] = useState<'fotos' | 'externo'>('fotos');
  const [ambienteGemelo, setAmbienteGemelo] = useState('');
  const [archivoGlb, setArchivoGlb] = useState<File | null>(null);
  const [subiendoGlb, setSubiendoGlb] = useState(false);
  const [errorGlb, setErrorGlb] = useState<string | null>(null);
  const esEdicion = Boolean(edicion);

  // Validación en tiempo real de superficies (paso 2)
  const validarSuperficie = (campo: 'superficieTotal' | 'superficieCubierta', valor: string) => {
    const n = Number(valor);
    setErrors(prev => {
      const next = { ...prev };
      if (valor !== '' && (!Number.isFinite(n) || n <= 0)) next[campo] = 'La superficie debe ser mayor a 0 m²';
      else delete next[campo];
      const total = campo === 'superficieTotal' ? n : Number(data.superficieTotal);
      const cub = campo === 'superficieCubierta' ? n : Number(data.superficieCubierta);
      if (Number.isFinite(total) && Number.isFinite(cub) && cub > 0 && total > 0 && cub > total) next.superficieCubierta = 'No puede superar la superficie total';
      else if (next.superficieCubierta === 'No puede superar la superficie total') delete next.superficieCubierta;
      return next;
    });
  };

  // Paso 1: el botón "Siguiente" queda inactivo hasta que la dirección esté verificada
  const direccionValida =
    data.direccion.trim().length > 0 &&
    (verifDir.estado === 'ok' || verifDir.estado === 'sin-servicio');
  const puedeAvanzar = step !== 1 || direccionValida;

  const agregarFotos = (archivos: FileList | null) => {
    if (!archivos) return;
    const imagenes = Array.from(archivos).filter(f => f.type.startsWith('image/'));
    setPhotos(prev => [...prev, ...imagenes].slice(0, 12));
  };
  const quitarFoto = (index: number) => setPhotos(prev => prev.filter((_, i) => i !== index));

  useEffect(() => {
    if (esEdicion) setGuardarComoBorrador(true);
    else sessionStorage.removeItem(DRAFT_KEY);
  }, []);

  const previews = useMemo(() => photos.map(file => ({ file, url: URL.createObjectURL(file) })), [photos]);
  useEffect(() => () => previews.forEach(({ url }) => URL.revokeObjectURL(url)), [previews]);

  const update = <K extends keyof FormData>(field: K, value: FormData[K]) => setData(prev => ({ ...prev, [field]: value }));
  const toggleAmenity = (amenity: string) => update('comodidades', data.comodidades.includes(amenity) ? data.comodidades.filter(item => item !== amenity) : [...data.comodidades, amenity]);

  const activarModelo3d = async () => {
    setQuiereModelo3d(true);
    setGemeloFase('conectando');
    setModoSubida('fotos');
    setAmbienteGemelo('');
    setArchivoGlb(null);
    setErrorGlb(null);
    const config = await obtenerConfigGemelo();
    if (!config) {
      setGemeloConfig(null);
      setGemeloFase('sin-worker');
      return;
    }
    setGemeloConfig(config);
    const conexion = await probarConexionWorker(config);
    setGemeloFase(conexion.ok ? 'subir' : 'sin-worker');
  };

  const desactivarModelo3d = () => {
    setQuiereModelo3d(false);
    setGemeloFase('sin-usar');
    setGemeloJobId(null);
    setGemeloJob(null);
    setModoSubida('fotos');
    setAmbienteGemelo('');
    setArchivoGlb(null);
    setErrorGlb(null);
  };

  const tituloGemelo = () => {
    const base = `${data.tipoUnidad} en ${data.direccion}`.trim();
    return ambienteGemelo ? `${base} — ${ambienteGemelo}` : base || 'Gemelo digital';
  };

  const vincularGlb = async () => {
    if (!archivoGlb || !gemeloConfig || subiendoGlb) return;
    setSubiendoGlb(true);
    setErrorGlb(null);
    try {
      const datosGlb = {
        titulo: tituloGemelo(),
        idUsuario: getUsuarioId() || null,
        idPublicacion: esEdicion ? String(edicion!.id!) : null,
        archivo: archivoGlb,
      };
      const job = visorEnSupabase(gemeloConfig)
        ? await subirModeloGLBSupabase(gemeloConfig, datosGlb)
        : await subirModeloExterno(gemeloConfig, datosGlb);
      setGemeloJob(job);
      setGemeloFase('listo');
      setArchivoGlb(null);
    } catch (e) {
      setErrorGlb(e instanceof Error ? e.message : 'No se pudo subir el modelo.');
    } finally {
      setSubiendoGlb(false);
    }
  };

  const supTotalNum = Number(data.superficieTotal) || 0;
  const supCubiertaNum = Number(data.superficieCubierta) || 0;
  const descubiertos = supTotalNum > 0 && supCubiertaNum > 0 && supTotalNum >= supCubiertaNum
    ? Math.round(supTotalNum - supCubiertaNum)
    : null;

  const validate = () => {
    const next: Record<string, string> = {};
    if (step === 1) {
      if (!data.direccion.trim()) next.direccion = 'Ingresá la dirección';
      if (verifDir.estado === 'invalida') next.direccion = verifDir.mensaje || 'La dirección no existe. Verificala e intentá de nuevo.';
    }
    if (step === 2) {
      if (Number(data.superficieTotal) <= 0) next.superficieTotal = 'Ingresá una superficie válida';
      if (Number(data.superficieCubierta) <= 0) next.superficieCubierta = 'Ingresá una superficie válida';
      if (Number(data.superficieCubierta) > Number(data.superficieTotal)) next.superficieCubierta = 'No puede superar la superficie total';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const verificarDireccionEnBlur = async () => {
    const direccion = data.direccion.trim();
    if (!direccion) { setVerifDir({ estado: 'idle' }); return; }
    setVerifDir({ estado: 'verificando' });
    try {
      const { ok, data: result } = await apiFetch<any>('/Apis/VerificarDireccion', {
        method: 'POST',
        body: JSON.stringify({ direccion, barrio: data.barrio || null, ciudad: 'Ciudad de Buenos Aires' }),
      }, 8000);
      const r = result?.data;
      if (!ok || !r) { setVerifDir({ estado: 'sin-servicio' }); return; }
      if (!r.existe) {
        setVerifDir({ estado: 'invalida', mensaje: 'No encontramos esa dirección. Revisá calle, altura y barrio.' });
      } else if (!data.barrio && r.barrioCanonizado) {
        setVerifDir({ estado: 'ok' });
        update('barrio', r.barrioCanonizado);
      } else if (r.barrioDetectado && !r.barrioCoincide) {
        setVerifDir({
          estado: 'barrio-distinto',
          mensaje: `Según Google Maps, esa dirección pertenece a ${r.barrioDetectado}, no a ${data.barrio}.`,
          sugerencia: r.barrioDetectado,
        });
      } else {
        setVerifDir({ estado: 'ok' });
      }
    } catch {
      setVerifDir({ estado: 'sin-servicio' });
    }
  };

  const salir = (destino: string) => {
    if (esEdicion) sessionStorage.removeItem(EDICION_KEY);
    navegarA(destino);
  };

  const submit = async () => {
    setSubmitting(true);
    const superficieTotal = Number(data.superficieTotal) || 0;
    const superficieCubierta = Number(data.superficieCubierta) || 0;
    const superficieDescubierta = Math.max(superficieTotal - superficieCubierta, 0);
    const fotosGuardadas: FotoGuardada[] = photos.length > 0
      ? photos.map(({ name, size, type }) => ({ name, size, type }))
      : (edicion?.fotos ?? []);
    const draft = { ...data, ciudad: 'Ciudad de Buenos Aires', superficieDescubierta, fotos: fotosGuardadas, modelo3d: gemeloJob ? { jobId: gemeloJob.id, motor: gemeloJob.motor, bytes: gemeloJob.modeloBytes } : null };
    const idPublicacion = esEdicion ? edicion!.id! : null;
    const body = {
      titulo: `${data.tipoUnidad} en ${data.direccion}`, descripcion: `Tasación automática. Comodidades: ${data.comodidades.join(', ') || 'sin declarar'}`,
      tipo_operacion: data.tipoTasacion, direccion: data.direccion, ciudad: 'Ciudad de Buenos Aires', barrio: data.barrio,
      tipo_propiedad: data.tipoUnidad, ambientes: Number(data.ambientes), dormitorios: Number(data.dormitorios), banos: Number(data.banos),
      superficie_cubierta: superficieCubierta, superficie_total: superficieTotal, piso: data.piso, antiguedad: Number(data.antiguedad) || null,
      orientacion: data.orientacion || null, disposicion: data.disposicion || null, estadoGeneral: data.estadoGeneral,
      luz_natural: data.luzNatural || null,
      expensas: Number(data.expensas) || 0, comodidades: data.comodidades, fotos: fotosGuardadas, usuario_id: getUsuarioId() || 'demo-user',
      es_borrador: esEdicion ? true : guardarComoBorrador,
      ...(idPublicacion ? { id_publicacion: idPublicacion } : {}),
      ...(gemeloJob ? { modelo3d_job_id: gemeloJob.id } : {}),
    };
    try {
      const { ok, data: result } = await apiFetch<any>(
        esEdicion ? '/Apis/ActualizarTasacion' : '/Apis/PublicarPropiedad',
        { method: 'POST', body: JSON.stringify(body) },
        25000
      );
      const payload = result?.data;
      if (esEdicion) {
        if (!ok || !payload?.id) {
          alert(result?.error || 'No se pudo actualizar la tasación. Intentá de nuevo.');
          return;
        }
        sessionStorage.removeItem(EDICION_KEY);
        try {
          sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
            ...draft,
            id: payload.id,
            demo: false,
            es_borrador: true,
            precioEstimadoUsd: payload?.precio_estimado_usd ?? null,
            coordenadas: edicion?.coordenadas ?? null,
          }));
        } catch {}
      } else {
        try {
          sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
            ...draft,
            id: payload?.id || `local-${Date.now()}`,
            demo: !(ok && payload?.saved),
            es_borrador: guardarComoBorrador,
            precioEstimadoUsd: payload?.precio_estimado_usd ?? null,
            coordenadas: payload?.coordenadas ?? null,
          }));
        } catch {}
      }
    } catch (error) {
      console.error(error);
      if (esEdicion) {
        alert('No se pudo actualizar la tasación. Revisá tu conexión e intentá de nuevo.');
        return;
      }
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, id: `demo-${Date.now()}`, demo: true }));
      } catch {}
    } finally { setSubmitting(false); }
    navegarA('/cargando');
  };

  const next = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!validate()) return; if (step < TOTAL_STEPS) setStep(current => current + 1); else await submit(); };

  const kicker = esEdicion ? `Editando borrador · Paso ${step} de ${TOTAL_STEPS}` : `Paso ${step} de ${TOTAL_STEPS}`;

  return <div className="tasacion">
    <div className="tasacion__progreso" aria-label={`Paso ${step} de ${TOTAL_STEPS}`}>
      {[1, 2, 3, 4].map((item, index) => (
        <React.Fragment key={item}>
          <span className={cn('tasacion__progreso-paso', step >= item && 'tasacion__progreso-paso--activa')}>
            <span className="tasacion__progreso-numero">{item}</span>
            <span className="tasacion__progreso-etiqueta">{PASOS[item - 1]}</span>
          </span>
          {index < TOTAL_STEPS - 1 && <span className={cn('tasacion__progreso-linea', step > item && 'tasacion__progreso-linea--activa')} />}
        </React.Fragment>
      ))}
    </div>
    <form onSubmit={next} noValidate className="tasacion__tarjeta">
      {step === 1 && <section>
        <div className="tasacion__encabezado"><p className="tasacion__encabezado-kicker">{kicker}</p><h1 className="tasacion__encabezado-titulo">Ubicación</h1><span className="tasacion__encabezado-sub">Contanos dónde está la propiedad y verificamos la dirección al instante.</span></div>
        {esEdicion && <div className="tasacion__aviso-edicion">Estás modificando una tasación en borrador. Al finalizar se actualizan los datos y se recalcula el precio.</div>}
        <div className="tasacion__toggle-pill" role="radiogroup" aria-label="Tipo de operación">
          <button type="button" role="radio" aria-checked={data.tipoTasacion === 'venta'} className={cn('tasacion__toggle-pill-opcion', data.tipoTasacion === 'venta' && 'tasacion__toggle-pill-opcion--activa')} onClick={() => update('tipoTasacion', 'venta')}>
            <TrendingUp className="tasacion__toggle-pill-icono" aria-hidden /> Venta
          </button>
          <button type="button" role="radio" aria-checked={data.tipoTasacion === 'alquiler'} className={cn('tasacion__toggle-pill-opcion', data.tipoTasacion === 'alquiler' && 'tasacion__toggle-pill-opcion--activa')} onClick={() => update('tipoTasacion', 'alquiler')}>
            <KeyRound className="tasacion__toggle-pill-icono" aria-hidden /> Alquiler
          </button>
        </div>
        <div className="tasacion__grilla tasacion__grilla--ubicacion">
          <div className="tasacion__campo">
            <Input label="Dirección" placeholder="Blas Parera 1301" value={data.direccion} onChange={e => { update('direccion', e.target.value); if (verifDir.estado !== 'idle') setVerifDir({ estado: 'idle' }); }} onBlur={verificarDireccionEnBlur} error={errors.direccion} />
            {verifDir.estado === 'verificando' && <p className="tasacion__verificacion">Verificando dirección…</p>}
            {verifDir.estado === 'ok' && <p className="tasacion__verificacion tasacion__verificacion--ok">✓ Dirección verificada</p>}
            {(verifDir.estado === 'invalida' || verifDir.estado === 'barrio-distinto') && (
              <p className="tasacion__verificacion tasacion__verificacion--aviso">
                {verifDir.mensaje}
                {verifDir.estado === 'barrio-distinto' && verifDir.sugerencia && (
                  <button type="button" className="tasacion__verificacion-boton" onClick={() => { update('barrio', verifDir.sugerencia!); setVerifDir({ estado: 'ok' }); }}>
                    Usar {verifDir.sugerencia}
                  </button>
                )}
              </p>
            )}
          </div>
          <Selector label="Barrio (opcional — lo detectamos de la dirección)" value={data.barrio} onChange={value => update('barrio', value)} placeholder="Detectar automáticamente…" opciones={BARRIOS_CABA} />
        </div>
      </section>}
      {step === 2 && <section>
        <div className="tasacion__encabezado"><p className="tasacion__encabezado-kicker">{kicker}</p><h1 className="tasacion__encabezado-titulo">Características</h1><span className="tasacion__encabezado-sub">Las variables clave que usa el modelo para tasar.</span></div>
        <div className="tasacion__eleccion">
          <TarjetaEleccion icono={Building2} titulo="Departamento" activo={data.tipoUnidad === 'Departamento'} onClick={() => update('tipoUnidad', 'Departamento')} />
          <TarjetaEleccion icono={Home} titulo="Casa" activo={data.tipoUnidad === 'Casa'} onClick={() => update('tipoUnidad', 'Casa')} />
        </div>
        <div className="tasacion__grilla">
          <Input label="Número de ambientes" type="number" min="0" max="50" value={data.ambientes} onChange={e => update('ambientes', e.target.value)} />
          <Input label="Antigüedad (años)" type="number" min="0" max="200" placeholder="Ej. 8" value={data.antiguedad} onChange={e => update('antiguedad', e.target.value)} />
          <Input label="Superficie total (m²)" type="number" min="1" value={data.superficieTotal} onChange={e => { update('superficieTotal', e.target.value); validarSuperficie('superficieTotal', e.target.value); }} error={errors.superficieTotal} />
          <div className="tasacion__campo">
            <Input label="Superficie cubierta (m²)" type="number" min="1" value={data.superficieCubierta} onChange={e => { update('superficieCubierta', e.target.value); validarSuperficie('superficieCubierta', e.target.value); }} error={errors.superficieCubierta} />
            {descubiertos !== null && <p className="tasacion__hint">Descubiertos: {descubiertos} m²</p>}
          </div>
          <Input label="Baños" type="number" min="0" max="30" value={data.banos} onChange={e => update('banos', e.target.value)} />
          <Input label="Dormitorios" type="number" min="0" max="30" value={data.dormitorios} onChange={e => update('dormitorios', e.target.value)} />
          {data.tipoUnidad === 'Departamento' ? (
            <Input label="Piso" placeholder="Ej. 5, 2A, 6C" value={data.piso} onChange={e => update('piso', e.target.value)} error={errors.piso} />
          ) : (
            <Input label="Cantidad de pisos" type="number" min="1" max="10" placeholder="Ej. 2" value={data.piso} onChange={e => update('piso', e.target.value)} />
          )}
          <Selector label="Orientación" value={data.orientacion} onChange={value => update('orientacion', value)} placeholder="Seleccioná la orientación…" opciones={['Norte', 'Sur', 'Este', 'Oeste', 'Noreste', 'Noroeste', 'Sureste', 'Suroeste']} />
          <Selector label="Disposición" value={data.disposicion} onChange={value => update('disposicion', value)} placeholder="Seleccioná la disposición…" opciones={['Frente', 'Contrafrente', 'Interno', 'Lateral']} />
          <Selector label="Luz natural" value={data.luzNatural} onChange={value => update('luzNatural', value)} placeholder="Seleccioná la luminosidad…" opciones={OPCIONES_LUZ} />
          {data.tipoTasacion === 'alquiler' && <Input label="Expensas mensuales (ARS)" type="number" min="0" placeholder="Ej. 150000" value={data.expensas} onChange={e => update('expensas', e.target.value)} />}
        </div>
        <fieldset className="tasacion__estado"><legend>Estado percibido</legend><div className="tasacion__estado-botones"><button type="button" className={cn('tasacion__estado-btn', 'tasacion__estado-btn--optimo', data.estadoGeneral >= 8 && 'tasacion__estado-btn--seleccionado')} onClick={() => { update('estadoGeneral', 9); setShowSlider(false); }}>Óptimo</button><button type="button" className={cn('tasacion__estado-btn', 'tasacion__estado-btn--regular', data.estadoGeneral >= 5 && data.estadoGeneral < 8 && 'tasacion__estado-btn--seleccionado')} onClick={() => { update('estadoGeneral', 6); setShowSlider(false); }}>Regular</button><button type="button" className={cn('tasacion__estado-btn', 'tasacion__estado-btn--critico', data.estadoGeneral <= 4 && 'tasacion__estado-btn--seleccionado')} onClick={() => { update('estadoGeneral', 3); setShowSlider(false); }}>Crítico</button></div><button type="button" className="tasacion__estado-toggle" onClick={() => setShowSlider(prev => !prev)}>{showSlider ? 'Ocultar detalle' : '¿Más precisión?'}</button>{showSlider && <div className="tasacion__slider"><div className="tasacion__slider-valor" style={{ color: data.estadoGeneral >= 8 ? '#16a34a' : data.estadoGeneral >= 5 ? '#d97706' : '#dc2626' }}>{data.estadoGeneral}</div><input type="range" min="1" max="10" value={data.estadoGeneral} onChange={e => update('estadoGeneral', Number(e.target.value))} className="tasacion__slider-input" /><div className="tasacion__slider-labels"><span>1 — A refaccionar</span><span>10 — A estrenar</span></div></div>}</fieldset>
      </section>}
      {step === 3 && <section>
        <div className="tasacion__encabezado"><p className="tasacion__encabezado-kicker">{kicker}</p><h1 className="tasacion__encabezado-titulo">Extras y amenities</h1><span className="tasacion__encabezado-sub">Seleccioná todo lo que tenga la propiedad.</span></div>
        <div className="tasacion__amenities">{AMENITIES.map(amenity => {
          const seleccionado = data.comodidades.includes(amenity);
          return (
            <button key={amenity} type="button" aria-pressed={seleccionado} onClick={() => toggleAmenity(amenity)} className={cn('tasacion__amenity', seleccionado && 'tasacion__amenity--seleccionado')}>
              {seleccionado && <Check className="tasacion__amenity-check" aria-hidden />}
              {amenity}
            </button>
          );
        })}</div>
      </section>}
      {step === 4 && <section>
        <div className="tasacion__encabezado"><p className="tasacion__encabezado-kicker">{kicker}</p><h1 className="tasacion__encabezado-titulo">Fotos de la propiedad</h1><span className="tasacion__encabezado-sub">Podés sumar imágenes para complementar el análisis visual.</span></div>
        <div className="tasacion__gemelo">
          {gemeloFase === 'sin-usar' && (
            <div className="tasacion__gemelo-inicio">
              <button type="button" className="tasacion__gemelo-activar" onClick={activarModelo3d}>
                <Box aria-hidden />
                <span>
                  <strong>¿Querés un modelo 3D del ambiente?</strong>
                  <em>Subí fotos o un video de recorrido y armamos una réplica interactiva. Es opcional.</em>
                </span>
              </button>
            </div>
          )}

          {gemeloFase !== 'sin-usar' && (
            <div className="tasacion__gemelo-modos">
              <div className="tasacion__eleccion" role="group" aria-label="¿Querés generar un modelo 3D?">
                <TarjetaEleccion icono={Box} titulo="Sí, modelo 3D" activo={quiereModelo3d} onClick={activarModelo3d} />
                <TarjetaEleccion icono={Camera} titulo="No, solo fotos" activo={!quiereModelo3d} onClick={desactivarModelo3d} />
              </div>

              {gemeloFase === 'conectando' && <p className="tasacion__hint">Conectando con el servicio 3D…</p>}

              {gemeloFase === 'sin-worker' && (
                <div className="tasacion__aviso-gemelo">
                  <p>
                    <strong>El servicio 3D no está disponible ahora.</strong>{' '}
                    {gemeloConfig
                      ? `No responde en ${gemeloConfig.workerUrl}.`
                      : 'No está configurado en el servidor.'}{' '}
                    Podés seguir con fotos normales.
                  </p>
                  <div className="tasacion__acciones-gemelo">
                    <Button type="button" variant="outline" size="sm" onClick={desactivarModelo3d}>
                      Usar fotos normales
                    </Button>
                  </div>
                </div>
              )}

              {gemeloFase === 'subir' && gemeloConfig && (
                <>
                  <div className="tasacion__eleccion" role="group" aria-label="¿Cómo querés crear el modelo 3D?">
                    <TarjetaEleccion icono={Camera} titulo="Con fotos o video" activo={modoSubida === 'fotos'} onClick={() => setModoSubida('fotos')} />
                    <TarjetaEleccion icono={Box} titulo="Ya tengo un modelo 3D" activo={modoSubida === 'externo'} onClick={() => setModoSubida('externo')} />
                  </div>

                  {modoSubida === 'fotos' ? (
                    <>
                      <div className="tasacion__gemelo-ambientes" role="group" aria-label="¿Qué ambiente querés escanear?">
                        <span className="tasacion__gemelo-ambientes-label">¿Qué escaneás? (un ambiente por modelo)</span>
                        {AMBIENTES_3D.map(a => (
                          <button
                            key={a}
                            type="button"
                            className={cn('tasacion__chip', ambienteGemelo === a && 'tasacion__chip--activa')}
                            aria-pressed={ambienteGemelo === a}
                            onClick={() => setAmbienteGemelo(ambienteGemelo === a ? '' : a)}
                          >
                            {a}
                          </button>
                        ))}
                      </div>
                      <details className="tasacion__guia">
                        <summary>Cómo sacar las fotos o el video (guía rápida)</summary>
                        <ol>
                          <li>Escanear <strong>un ambiente por vez</strong>: el modelo es por habitación, no de toda la casa.</li>
                          <li>Parate en una esquina y girá lento barriendo toda la habitación, como si grabaras un video.</li>
                          <li>Avanzá unos pasos y repetí: cada pared y mueble debe verse en al menos 3 fotos.</li>
                          <li>Incluí piso y techo en varias fotos: ayudan a anclar la geometría.</li>
                          <li>Usá luz abundante y evitá apuntar directo a ventanas.</li>
                        </ol>
                        <p className="tasacion__guia-nota">15–25 fotos por ambiente dan un buen resultado, o un video de recorrido de hasta 3 minutos.</p>
                      </details>
                      <SubidaFotos
                        config={gemeloConfig}
                        tituloInicial={tituloGemelo()}
                        propiedad={esEdicion ? String(edicion!.id!) : null}
                        onTrabajoCreado={(id) => {
                          setGemeloJobId(id);
                          setGemeloFase('progreso');
                        }}
                      />
                    </>
                  ) : (
                    <div className="tasacion__gemelo-externo">
                      <p className="tasacion__hint">
                        ¿Escaneaste con Scaniverse, Polycam u otra app? Exportá el modelo en formato GLB, subilo acá y queda
                        vinculado a la tasación sin procesar nada.
                      </p>
                      <label className="tasacion__subida">
                        <input
                          type="file"
                          accept=".glb,model/gltf-binary"
                          onChange={e => {
                            setArchivoGlb(e.target.files?.[0] || null);
                            setErrorGlb(null);
                            e.target.value = '';
                          }}
                        />
                        <strong>Elegir archivo .glb</strong>
                        <span>Modelo exportado en glTF binario · hasta 120 MB</span>
                      </label>
                      {archivoGlb && <p className="tasacion__hint">{archivoGlb.name} · {Math.round(archivoGlb.size / 1024)} KB</p>}
                      {errorGlb && <p className="tasacion__error">{errorGlb}</p>}
                      <div className="tasacion__acciones-gemelo">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={!archivoGlb || subiendoGlb}
                          isLoading={subiendoGlb}
                          onClick={vincularGlb}
                        >
                          Vincular modelo a la tasación
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {gemeloFase === 'progreso' && gemeloConfig && gemeloJobId && (
                <BarraProgreso
                  config={gemeloConfig}
                  jobId={gemeloJobId}
                  onListo={job => {
                    setGemeloJob(job);
                    setGemeloFase('listo');
                  }}
                  onCancelar={() => {
                    setGemeloJobId(null);
                    setGemeloJob(null);
                    setGemeloFase('subir');
                  }}
                />
              )}

              {gemeloFase === 'listo' && gemeloConfig && gemeloJob && (
                <Visor3D
                  config={gemeloConfig}
                  job={gemeloJob}
                  onNuevo={() => {
                    setGemeloJob(null);
                    setGemeloJobId(null);
                    setGemeloFase('subir');
                  }}
                />
              )}
            </div>
          )}
        </div>
        <label
          className={cn('tasacion__subida', arrastrando && 'tasacion__subida--activa')}
          onDragOver={e => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={e => { e.preventDefault(); setArrastrando(false); agregarFotos(e.dataTransfer.files); }}
        >{''}
          <input type="file" accept="image/*" multiple onChange={e => { agregarFotos(e.target.files); e.target.value = ''; }} />
          <strong>Arrastrá las fotos acá o hacé clic para subirlas</strong>
          <span>JPG, PNG o WEBP · hasta 12 fotos</span>
        </label>
        {previews.length > 0 && (
          <div className="tasacion__fotos">
            {previews.map(({ file, url }, index) => (
              <div key={`${file.name}-${file.lastModified}`} className="tasacion__foto">
                <img src={url} alt={file.name} />
                <button type="button" className="tasacion__foto-quitar" aria-label={`Eliminar ${file.name}`} onClick={() => quitarFoto(index)}>
                  <X aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
        <label className="tasacion__borrador"><input type="checkbox" checked={guardarComoBorrador} disabled={esEdicion} onChange={e => setGuardarComoBorrador(e.target.checked)} /><span>{esEdicion ? 'Esta tasación se actualiza como borrador; podés completarla cuando quieras.' : 'Guardar como borrador (podés completarla después desde el Dashboard)'}</span></label>
      </section>}
      <div className="tasacion__acciones">{step > 1 ? <Button type="button" variant="outline" disabled={submitting} onClick={() => setStep(current => current - 1)}>Atrás</Button> : <Button type="button" variant="outline" disabled={submitting} onClick={() => salir('/dashboard')}>Cancelar</Button>}<Button type="submit" variant="primary" isLoading={submitting} disabled={submitting || !puedeAvanzar}>{step === TOTAL_STEPS ? (esEdicion ? 'Guardar cambios y recalcular' : 'Finalizar y calcular') : 'Siguiente'}</Button></div>
      {step === 1 && !direccionValida && !errors.direccion && (
        <p className="tasacion__nota-validacion">Ingresá y verificá la dirección para continuar.</p>
      )}
    </form>
    {submitting && (
      <div className="tasacion__bloqueo" role="status" aria-live="polite">
        <Loader2 className="tasacion__bloqueo-icono" aria-hidden />
        <p>Calculando tu tasación… esto puede tardar unos segundos.</p>
      </div>
    )}
  </div>;
};
