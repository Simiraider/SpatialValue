import React, { useEffect, useMemo, useState } from 'react';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { navigate } from '../lib/navigate';
import { apiFetch } from '../lib/api';
import { getUsuarioId } from '../lib/session';
import { BARRIOS_CABA } from '../lib/mercado';
import { cn } from '../lib/utils';

const TOTAL_STEPS = 3;
const AMENITIES = ['Seguridad 24h', 'Ascensor', 'Cochera', 'Gimnasio', 'Baulera', 'Cámaras', 'Balcón', 'Lounge', 'Terraza', 'Pileta', 'Patio', 'Parrilla', 'Laundry'];

type FormData = {
  tipoTasacion: 'venta' | 'alquiler'; direccion: string; barrio: string;
  tipoUnidad: 'Casa' | 'Departamento'; superficieTotal: string; superficieCubierta: string;
  ambientes: string; antiguedad: string; banos: string; dormitorios: string; piso: string;
  orientacion: string; disposicion: string; comodidades: string[]; estadoGeneral: number; expensas: string;
};

const initialData: FormData = {
  tipoTasacion: 'venta', direccion: '', barrio: '', tipoUnidad: 'Departamento',
  superficieTotal: '', superficieCubierta: '', ambientes: '3', antiguedad: '', banos: '1', dormitorios: '1',
  piso: '0', orientacion: '', disposicion: '', comodidades: [], estadoGeneral: 7, expensas: '',
};

function Selector({ label, value, onChange, children, error }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode; error?: string }) {
  return <div className="flex flex-col space-y-1.5 w-full">
    <label className="text-sm font-semibold text-slate-700 ml-1">{label}</label>
    <select className={cn('sv-control', error && 'ring-2 ring-red-500')} value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    {error && <p className="text-sm text-red-500 ml-1">{error}</p>}
  </div>;
}

export const PropertyForm = () => {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<FormData>(initialData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [showSlider, setShowSlider] = useState(false);

  useEffect(() => { sessionStorage.removeItem('tasacion-draft'); }, []);
  const previews = useMemo(() => photos.map(file => ({ file, url: URL.createObjectURL(file) })), [photos]);
  useEffect(() => () => previews.forEach(({ url }) => URL.revokeObjectURL(url)), [previews]);

  const update = <K extends keyof FormData>(field: K, value: FormData[K]) => setData(prev => ({ ...prev, [field]: value }));
  const toggleAmenity = (amenity: string) => update('comodidades', data.comodidades.includes(amenity) ? data.comodidades.filter(item => item !== amenity) : [...data.comodidades, amenity]);

  const validate = () => {
    const next: Record<string, string> = {};
    if (step === 1) {
      if (!data.direccion.trim()) next.direccion = 'Ingresá la dirección';
      if (!data.barrio) next.barrio = 'Seleccioná el barrio';
      if (Number(data.superficieTotal) <= 0) next.superficieTotal = 'Ingresá una superficie válida';
      if (Number(data.superficieCubierta) <= 0) next.superficieCubierta = 'Ingresá una superficie válida';
      if (Number(data.superficieCubierta) > Number(data.superficieTotal)) next.superficieCubierta = 'No puede superar la superficie total';
    }
    setErrors(next); return Object.keys(next).length === 0;
  };

  const submit = async () => {
    setSubmitting(true);
    const superficieTotal = Number(data.superficieTotal) || 0;
    const superficieCubierta = Number(data.superficieCubierta) || 0;
    const superficieDescubierta = Math.max(superficieTotal - superficieCubierta, 0);
    const draft = { ...data, ciudad: 'Ciudad de Buenos Aires', superficieDescubierta, fotos: photos.map(({ name, size, type }) => ({ name, size, type })) };
    const body = {
      titulo: `${data.tipoUnidad} en ${data.direccion}`, descripcion: `Tasación automática. Comodidades: ${data.comodidades.join(', ') || 'sin declarar'}`,
      tipo_operacion: data.tipoTasacion, direccion: data.direccion, ciudad: 'Ciudad de Buenos Aires', barrio: data.barrio,
      tipo_propiedad: data.tipoUnidad, ambientes: Number(data.ambientes), dormitorios: Number(data.dormitorios), banos: Number(data.banos),
      superficie_cubierta: superficieCubierta, superficie_total: superficieTotal, piso: data.piso, antiguedad: Number(data.antiguedad) || null,
      orientacion: data.orientacion || null, disposicion: data.disposicion || null, estadoGeneral: data.estadoGeneral,
      expensas: Number(data.expensas) || 0, comodidades: data.comodidades, fotos: draft.fotos, usuario_id: getUsuarioId() || 'demo-user',
    };
    try {
      const { ok, data: result } = await apiFetch<any>('/Apis/PublicarPropiedad', { method: 'POST', body: JSON.stringify(body) }, 15000);
      const payload = result?.data;
      sessionStorage.setItem('tasacion-draft', JSON.stringify({ ...draft, id: payload?.id || `local-${Date.now()}`, demo: !(ok && payload?.saved), precioEstimadoUsd: payload?.precio_estimado_usd ?? null, coordenadas: payload?.coordenadas ?? null }));
    } catch (error) {
      console.error(error);
      sessionStorage.setItem('tasacion-draft', JSON.stringify({ ...draft, id: `demo-${Date.now()}`, demo: true }));
    } finally { setSubmitting(false); navigate('/cargando'); }
  };

  const next = async (event: React.FormEvent) => { event.preventDefault(); if (!validate()) return; if (step < TOTAL_STEPS) setStep(current => current + 1); else await submit(); };

  return <div className="sv-form">
    <div className="sv-progress" aria-label={`Paso ${step} de ${TOTAL_STEPS}`}>{[1, 2, 3].map((item, index) => <React.Fragment key={item}><span className={cn('sv-progress-dot', step >= item && 'is-active')}>{item}</span>{index < 2 && <span className={cn('sv-progress-line', step > item && 'is-active')} />}</React.Fragment>)}</div>
    <form onSubmit={next} noValidate className="sv-form-card">
      {step === 1 && <section>
        <div className="sv-heading"><p>Paso 1 de 3</p><h1>Datos generales</h1><span>Contanos las características principales de la propiedad.</span></div>
        <div className="sv-choice-row"><Button type="button" variant={data.tipoTasacion === 'venta' ? 'primary' : 'outline'} fullWidth onClick={() => update('tipoTasacion', 'venta')}>Venta</Button><Button type="button" variant={data.tipoTasacion === 'alquiler' ? 'primary' : 'outline'} fullWidth onClick={() => update('tipoTasacion', 'alquiler')}>Alquiler</Button></div>
        <div className="sv-choice-row"><Button type="button" variant={data.tipoUnidad === 'Departamento' ? 'primary' : 'outline'} fullWidth onClick={() => update('tipoUnidad', 'Departamento')}>Departamento</Button><Button type="button" variant={data.tipoUnidad === 'Casa' ? 'primary' : 'outline'} fullWidth onClick={() => update('tipoUnidad', 'Casa')}>Casa</Button></div>
        <div className="sv-grid">
          <Input label="Dirección" placeholder="Blas Parera 1301" value={data.direccion} onChange={e => update('direccion', e.target.value)} error={errors.direccion} />
          <Selector label="Barrio" value={data.barrio} onChange={value => update('barrio', value)} error={errors.barrio}><option value="">Seleccioná un barrio…</option>{BARRIOS_CABA.map(barrio => <option key={barrio} value={barrio}>{barrio}</option>)}</Selector>
          <Input label="Número de ambientes" type="number" min="0" max="50" value={data.ambientes} onChange={e => update('ambientes', e.target.value)} />
          <Input label="Antigüedad (años)" type="number" min="0" max="200" placeholder="Ej. 8" value={data.antiguedad} onChange={e => update('antiguedad', e.target.value)} />
          <Input label="Superficie total (m²)" type="number" min="1" value={data.superficieTotal} onChange={e => update('superficieTotal', e.target.value)} error={errors.superficieTotal} />
          <Input label="Superficie cubierta (m²)" type="number" min="1" value={data.superficieCubierta} onChange={e => update('superficieCubierta', e.target.value)} error={errors.superficieCubierta} />
          <Input label="Baños" type="number" min="0" max="30" value={data.banos} onChange={e => update('banos', e.target.value)} />
          <Input label="Dormitorios" type="number" min="0" max="30" value={data.dormitorios} onChange={e => update('dormitorios', e.target.value)} />
          {data.tipoUnidad === 'Departamento' ? (
            <Input label="Piso" placeholder="Ej. 5, 2A, 6C" value={data.piso} onChange={e => update('piso', e.target.value)} error={errors.piso} />
          ) : (
            <Input label="Cantidad de pisos" type="number" min="1" max="10" placeholder="Ej. 2" value={data.piso} onChange={e => update('piso', e.target.value)} />
          )}
          <Selector label="Orientación" value={data.orientacion} onChange={value => update('orientacion', value)}><option value="">Seleccioná la orientación…</option>{['Norte', 'Sur', 'Este', 'Oeste', 'Noreste', 'Noroeste', 'Sureste', 'Suroeste'].map(option => <option key={option}>{option}</option>)}</Selector>
          <Selector label="Disposición" value={data.disposicion} onChange={value => update('disposicion', value)}><option value="">Seleccioná la disposición…</option>{['Frente', 'Contrafrente', 'Interno', 'Lateral'].map(option => <option key={option}>{option}</option>)}</Selector>
          {data.tipoTasacion === 'alquiler' && <Input label="Expensas mensuales (ARS)" type="number" min="0" placeholder="Ej. 150000" value={data.expensas} onChange={e => update('expensas', e.target.value)} />}
        </div>
        <fieldset className="sv-state"><legend>Estado percibido</legend><div className="sv-state-buttons"><button type="button" className={cn('sv-state-btn', 'sv-state--optimo', data.estadoGeneral >= 8 && 'is-selected')} onClick={() => { update('estadoGeneral', 9); setShowSlider(false); }}>Óptimo</button><button type="button" className={cn('sv-state-btn', 'sv-state--regular', data.estadoGeneral >= 5 && data.estadoGeneral < 8 && 'is-selected')} onClick={() => { update('estadoGeneral', 6); setShowSlider(false); }}>Regular</button><button type="button" className={cn('sv-state-btn', 'sv-state--critico', data.estadoGeneral <= 4 && 'is-selected')} onClick={() => { update('estadoGeneral', 3); setShowSlider(false); }}>Crítico</button></div><button type="button" className="sv-state-toggle" onClick={() => setShowSlider(prev => !prev)}>{showSlider ? 'Ocultar detalle' : '¿Más precisión?'}</button>{showSlider && <div className="sv-slider"><div className="sv-slider-value" style={{ color: data.estadoGeneral >= 8 ? '#16a34a' : data.estadoGeneral >= 5 ? '#d97706' : '#dc2626' }}>{data.estadoGeneral}</div><input type="range" min="1" max="10" value={data.estadoGeneral} onChange={e => update('estadoGeneral', Number(e.target.value))} className="sv-slider-input" /><div className="sv-slider-labels"><span>1 — A refaccionar</span><span>10 — A estrenar</span></div></div>}</fieldset>
      </section>}
      {step === 2 && <section><div className="sv-heading"><p>Paso 2 de 3</p><h1>Extras y amenities</h1><span>Seleccioná todo lo que tenga la propiedad.</span></div><div className="sv-amenities">{AMENITIES.map(amenity => <button key={amenity} type="button" onClick={() => toggleAmenity(amenity)} className={cn(data.comodidades.includes(amenity) && 'is-selected')}>{amenity}</button>)}</div></section>}
      {step === 3 && <section><div className="sv-heading"><p>Paso 3 de 3</p><h1>Fotos de la propiedad</h1><span>Podés sumar imágenes para complementar el análisis visual.</span></div><label className="sv-upload"><input type="file" accept="image/*" multiple onChange={e => setPhotos(Array.from(e.target.files || []).slice(0, 12))} /><strong>Subí imágenes</strong><span>JPG, PNG o WEBP · hasta 12 fotos</span></label>{previews.length > 0 && <div className="sv-photo-grid">{previews.map(({ file, url }) => <img key={`${file.name}-${file.lastModified}`} src={url} alt={file.name} />)}</div>}</section>}
      <div className="sv-actions">{step > 1 ? <Button type="button" variant="outline" disabled={submitting} onClick={() => setStep(current => current - 1)}>Atrás</Button> : <Button type="button" variant="outline" onClick={() => navigate('/dashboard')}>Cancelar</Button>}<Button type="submit" variant="primary" isLoading={submitting} disabled={submitting}>{step === TOTAL_STEPS ? 'Finalizar y calcular' : 'Siguiente'}</Button></div>
    </form>
  </div>;
};
