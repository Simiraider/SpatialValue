import React, { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Building2, Box, Camera, Check, Home, KeyRound, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { navegarA, esIdSeguro } from '../lib/navigate';
import { apiFetch } from '../lib/api';
import { getUsuarioId } from '../lib/session';
import { BARRIOS_CABA } from '../lib/mercado';
import { cn } from '../lib/utils';
import { obtenerConfigGemelo, probarConexionWorker, type ConfigGemelo, type EstadoTrabajo } from '../lib/gemelo';
import { SubidaFotos } from './GemeloDigital/SubidaFotos';
import { BarraProgreso } from './GemeloDigital/BarraProgreso';
import { Visor3D } from './GemeloDigital/Visor3D';

const TOTAL_STEPS = 4;
const PASOS = ['Ubicación', 'Características', 'Extras', 'Fotos'];
const AMENITIES = ['Seguridad 24h', 'Ascensor', 'Cochera', 'Gimnasio', 'Baulera', 'Cámaras', 'Balcón', 'Lounge', 'Terraza', 'Pileta', 'Patio', 'Parrilla', 'Laundry'];
const OPCIONES_LUZ = ['Abundante', 'Buena', 'Media', 'Poca'];
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

function Selector({ label, value, onChange, children, error }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode; error?: string }) {
  return <div className="tasacion__campo">
    <label className="tasacion__etiqueta">{label}</label>
    <select className={cn('tasacion__control', error && 'tasacion__control--invalido')} value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
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
  const [quiereModelo3d, setQuiereModelo3d] = useState(false);
  const [gemeloFase, setGemeloFase] = useState<'sin-usar' | 'conectando' | 'subir' | 'progreso' | 'listo' | 'sin-worker'>('sin-usar');
  const [gemeloConfig, setGemeloConfig] = useState<ConfigGemelo | null>(null);
  const [gemeloJobId, setGemeloJobId] = useState<string | null>(null);
  const [gemeloJob, setGemeloJob] = useState<EstadoTrabajo | null>(null);
  const [verModelo, setVerModelo] = useState(false);
  const esEdicion = Boolean(edicion);

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
    const config = await obtenerConfigGemelo();
    if (!config) { setGemeloConfig(null); setGemeloFase('sin-worker'); return; }
    setGemeloConfig(config);
    const conexion = await probarConexionWorker(config);
    setGemeloFase(conexion.ok ? 'subir' : 'sin-worker');
  };

  const desactivarModelo3d = () => {
    setQuiereModelo3d(false);
    setGemeloFase('sin-usar');
    setGemeloJobId(null);
    setGemeloJob(null);
    setVerModelo(false);
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
        <div className="tasacion__eleccion">
          <TarjetaEleccion icono={TrendingUp} titulo="Venta" activo={data.tipoTasacion === 'venta'} onClick={() => update('tipoTasacion', 'venta')} />
          <TarjetaEleccion icono={KeyRound} titulo="Alquiler" activo={data.tipoTasacion === 'alquiler'} onClick={() => update('tipoTasacion', 'alquiler')} />
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
          <Selector label="Barrio (opcional — lo detectamos de la dirección)" value={data.barrio} onChange={value => update('barrio', value)}><option value="">Detectar automáticamente…</option>{BARRIOS_CABA.map(barrio => <option key={barrio} value={barrio}>{barrio}</option>)}</Selector>
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
          <Input label="Superficie total (m²)" type="number" min="1" value={data.superficieTotal} onChange={e => update('superficieTotal', e.target.value)} error={errors.superficieTotal} />
          <div className="tasacion__campo">
            <Input label="Superficie cubierta (m²)" type="number" min="1" value={data.superficieCubierta} onChange={e => update('superficieCubierta', e.target.value)} error={errors.superficieCubierta} />
            {descubiertos !== null && <p className="tasacion__hint">Descubiertos: {descubiertos} m²</p>}
          </div>
          <Input label="Baños" type="number" min="0" max="30" value={data.banos} onChange={e => update('banos', e.target.value)} />
          <Input label="Dormitorios" type="number" min="0" max="30" value={data.dormitorios} onChange={e => update('dormitorios', e.target.value)} />
          {data.tipoUnidad === 'Departamento' ? (
            <Input label="Piso" placeholder="Ej. 5, 2A, 6C" value={data.piso} onChange={e => update('piso', e.target.value)} error={errors.piso} />
          ) : (
            <Input label="Cantidad de pisos" type="number" min="1" max="10" placeholder="Ej. 2" value={data.piso} onChange={e => update('piso', e.target.value)} />
          )}
          <Selector label="Orientación" value={data.orientacion} onChange={value => update('orientacion', value)}><option value="">Seleccioná la orientación…</option>{['Norte', 'Sur', 'Este', 'Oeste', 'Noreste', 'Noroeste', 'Sureste', 'Suroeste'].map(option => <option key={option}>{option}</option>)}</Selector>
          <Selector label="Disposición" value={data.disposicion} onChange={value => update('disposicion', value)}><option value="">Seleccioná la disposición…</option>{['Frente', 'Contrafrente', 'Interno', 'Lateral'].map(option => <option key={option}>{option}</option>)}</Selector>
          <Selector label="Luz natural" value={data.luzNatural} onChange={value => update('luzNatural', value)}><option value="">Seleccioná la luminosidad…</option>{OPCIONES_LUZ.map(option => <option key={option}>{option}</option>)}</Selector>
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
        <div className="tasacion__encabezado"><p className="tasacion__encabezado-kicker">{kicker}</p><h1 className="tasacion__encabezado-titulo">Fotos de la propiedad</h1><span className="tasacion__encabezado-sub">¿Querés que la tasación incluya un modelo 3D? Elegí cómo seguir.</span></div>
        <div className="tasacion__eleccion" role="group" aria-label="¿Querés generar un modelo 3D de la propiedad?">
          <TarjetaEleccion icono={Box} titulo="Sí, generar modelo 3D" activo={quiereModelo3d} onClick={activarModelo3d} />
          <TarjetaEleccion icono={Camera} titulo="No, solo fotos normales" activo={!quiereModelo3d} onClick={desactivarModelo3d} />
        </div>
        {quiereModelo3d ? <div className="tasacion__gemelo">
          <p className="tasacion__hint">Las fotos se usan para reconstruir el modelo 3D (mínimo 5, con solapamiento, o un video) y no se guardan.</p>
          {gemeloFase === 'conectando' && <p className="tasacion__hint">Conectando con el servicio 3D…</p>}
          {gemeloFase === 'sin-worker' && <div className="tasacion__aviso-gemelo">
            <p><strong>El servicio 3D no está disponible ahora.</strong> {gemeloConfig ? `No responde en ${gemeloConfig.workerUrl}.` : 'No está configurado (falta PUBLIC_GEMELO_WORKER_URL).'}</p>
            <div className="tasacion__acciones-gemelo">
              <Button type="button" variant="outline" onClick={desactivarModelo3d}>Usar fotos normales</Button>
              <Button type="button" variant="secondary" onClick={activarModelo3d}>Reintentar conexión</Button>
            </div>
          </div>}
          {gemeloFase === 'subir' && gemeloConfig && <SubidaFotos
            config={gemeloConfig}
            tituloInicial={`${data.tipoUnidad} en ${data.direccion}`}
            propiedad={esEdicion ? String(edicion!.id!) : null}
            onTrabajoCreado={(id) => { setGemeloJobId(id); setGemeloFase('progreso'); }}
          />}
          {gemeloFase === 'progreso' && gemeloConfig && gemeloJobId && <BarraProgreso
            config={gemeloConfig}
            jobId={gemeloJobId}
            onListo={(job) => { setGemeloJob(job); setGemeloFase('listo'); }}
            onCancelar={() => { setGemeloJobId(null); setGemeloFase('subir'); }}
          />}
          {gemeloFase === 'listo' && gemeloConfig && gemeloJob && <div className="tasacion__gemelo-listo">
            <p className="tasacion__verificacion tasacion__verificacion--ok">✓ Modelo 3D generado — se vincula a esta tasación al finalizar.</p>
            <p className="tasacion__hint">{gemeloJob.motor === 'simular' ? 'Modelo de demostración.' : `Modelo real con ${gemeloJob.totalFotos} fotos.`}{gemeloJob.modeloBytes ? ` ${Math.round(gemeloJob.modeloBytes / 1024)} KB.` : ''} El modelo vive 1 hora en el servicio 3D.</p>
            <div className="tasacion__acciones-gemelo">
              <Button type="button" variant="outline" onClick={() => setVerModelo(v => !v)}>{verModelo ? 'Ocultar modelo 3D' : 'Ver el modelo 3D'}</Button>
              <Button type="button" variant="ghost" onClick={() => { setGemeloJob(null); setGemeloJobId(null); setGemeloFase('subir'); }}>Generar de nuevo</Button>
            </div>
            {verModelo && <Visor3D config={gemeloConfig} job={gemeloJob} onNuevo={() => { setGemeloJob(null); setGemeloJobId(null); setGemeloFase('subir'); }} />}
          </div>}
        </div> : <>
          <label className="tasacion__subida"><input type="file" accept="image/*" multiple onChange={e => setPhotos(Array.from(e.target.files || []).slice(0, 12))} /><strong>Subí imágenes</strong><span>JPG, PNG o WEBP · hasta 12 fotos</span></label>
          {previews.length > 0 && <div className="tasacion__fotos">{previews.map(({ file, url }) => <img key={`${file.name}-${file.lastModified}`} src={url} alt={file.name} />)}</div>}
        </>}
        <label className="tasacion__borrador"><input type="checkbox" checked={guardarComoBorrador} disabled={esEdicion} onChange={e => setGuardarComoBorrador(e.target.checked)} /><span>{esEdicion ? 'Esta tasación se actualiza como borrador; podés completarla cuando quieras.' : 'Guardar como borrador (podés completarla después desde el Dashboard)'}</span></label>
      </section>}
      <div className="tasacion__acciones">{step > 1 ? <Button type="button" variant="outline" disabled={submitting} onClick={() => setStep(current => current - 1)}>Atrás</Button> : <Button type="button" variant="outline" disabled={submitting} onClick={() => salir('/dashboard')}>Cancelar</Button>}<Button type="submit" variant="primary" isLoading={submitting} disabled={submitting}>{step === TOTAL_STEPS ? (esEdicion ? 'Guardar cambios y recalcular' : 'Finalizar y calcular') : 'Siguiente'}</Button></div>
    </form>
  </div>;
};
