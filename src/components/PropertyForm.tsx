import { useState } from 'react';
import { Button } from './ui/Button';
import { UploadBox } from './UploadBox';
import { navigate } from '../lib/navigate';
import { getCookie } from '../lib/utils';
const unitTypes = ['Casa', 'Departamento', 'PH', 'Terreno'];

const servicesList = [
  'Seguridad 24hs', 'Gas', 'Luz', 'Agua', 'Internet', 'Cochera'
];

const TOTAL_STEPS = 3;

type FormData = {
  ambientes: number;
  dormitorios: number;
  banos: number;
  cocheras: number;
  antiguedad: number;
  tipoPropiedad: string;
  piso: number;
  precio: string;
  moneda: string;
  ubicacion: string;
  servicios: string[];
};

const initialData: FormData = {
  ambientes: 0,
  dormitorios: 0,
  banos: 0,
  cocheras: 0,
  antiguedad: 0,
  tipoPropiedad: 'Casa',
  piso: 0,
  precio: '',
  moneda: 'ARS',
  ubicacion: '',
  servicios: ['Seguridad 24hs', 'Gas', 'Luz'],
};

const CounterField = ({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) => (
  <div className="pf-field">
    <label className="pf-label">{label}</label>
    <div className="pf-counter">
      <button type="button" className="pf-counter-btn" onClick={() => onChange(Math.max(0, value - 1))}>−</button>
      <span className="pf-counter-value">{value}</span>
      <button type="button" className="pf-counter-btn" onClick={() => onChange(value + 1)}>+</button>
    </div>
  </div>
);

export const PropertyForm = () => {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<FormData>(initialData);

  const update = <K extends keyof FormData>(field: K, value: FormData[K]) =>
    setData((prev) => ({ ...prev, [field]: value }));

  const toggleService = (svc: string) => {
    setData((prev) => ({
      ...prev,
      servicios: prev.servicios.includes(svc)
        ? prev.servicios.filter((s) => s !== svc)
        : [...prev.servicios, svc],
    }));
  };

  const handleNext = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step < TOTAL_STEPS) {
      setStep((s) => s + 1);
      return;
    }

    try {
      const usuarioId = getCookie('usuario_id');
      if (!usuarioId) {
        alert("Debes iniciar sesión para tasar una propiedad.");
        return;
      }

      const body = {
        titulo: `${data.tipoPropiedad} en ${data.ubicacion || 'sin dirección'}`,
        descripcion: `Ambientes: ${data.ambientes}, Dorm: ${data.dormitorios}, Baños: ${data.banos}`,
        precio: Number(data.precio) || 0,
        direccion: data.ubicacion,
        habitaciones: data.ambientes,
        baños: data.banos,
        area_m2: 0,
        usuario_id: usuarioId
      };

      const res = await fetch('/Apis/PublicarPropiedad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const resData = await res.json();

      if (res.ok && resData.success) {
        sessionStorage.setItem('tasacion-draft', JSON.stringify(data));
        navigate('/cargando');
      } else {
        alert(`Error al guardar: ${resData.error || 'Error desconocido'}`);
      }
    } catch (error) {
      console.error(error);
      alert("Error de conexión al enviar la tasación.");
    }
  };

  return (
    <div className="pf-wrap">
      <div className="pf-header">
        <button type="button" className="pf-back" onClick={() => step > 1 ? setStep(s => s - 1) : navigate('/tasacion')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Volver
        </button>
        <span className="pf-logo">
          <img src="/logo.svg" alt="SpatialValue" width="28" height="28" />
        </span>
      </div>

      <div className="pf-progress">
        <div className={`pf-progress-node ${step >= 1 ? 'pf-progress-node--active' : ''}`}>
          <span>1</span>
        </div>
        <div className={`pf-progress-line ${step >= 2 ? 'pf-progress-line--active' : ''}`}></div>
        <div className={`pf-progress-node ${step >= 2 ? 'pf-progress-node--active' : ''}`}>
          <span>2</span>
        </div>
        <div className={`pf-progress-line ${step >= 3 ? 'pf-progress-line--active' : ''}`}></div>
        <div className={`pf-progress-node ${step >= 3 ? 'pf-progress-node--active' : ''}`}>
          <span>3</span>
        </div>
      </div>

      <form className="pf-form" onSubmit={handleNext}>
        {step === 1 && (
          <div className="pf-step">
            <div className="pf-grid-2">
              <CounterField label="Número de ambientes" value={data.ambientes} onChange={(v) => update('ambientes', v)} />
              <CounterField label="Cantidad de dormitorios" value={data.dormitorios} onChange={(v) => update('dormitorios', v)} />
              <CounterField label="Cantidad de baños" value={data.banos} onChange={(v) => update('banos', v)} />
              <CounterField label="Cantidad de cocheras" value={data.cocheras} onChange={(v) => update('cocheras', v)} />
            </div>
            <div className="pf-grid-2">
              <div className="pf-field">
                <label className="pf-label">Antigüedad (años)</label>
                <div className="pf-counter pf-counter--inline">
                  <button type="button" className="pf-counter-btn" onClick={() => update('antiguedad', Math.max(0, data.antiguedad - 1))}>−</button>
                  <span className="pf-counter-value">{data.antiguedad}</span>
                  <button type="button" className="pf-counter-btn" onClick={() => update('antiguedad', data.antiguedad + 1)}>+</button>
                </div>
              </div>
              <div className="pf-field">
                <label className="pf-label">Tipo de propiedad</label>
                <select className="pf-select" value={data.tipoPropiedad} onChange={(e) => update('tipoPropiedad', e.target.value)}>
                  {unitTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="pf-step">
            <div className="pf-grid-3">
              <div className="pf-field">
                <label className="pf-label">Piso</label>
                <div className="pf-counter pf-counter--inline">
                  <button type="button" className="pf-counter-btn" onClick={() => update('piso', Math.max(0, data.piso - 1))}>−</button>
                  <span className="pf-counter-value">{data.piso}</span>
                  <button type="button" className="pf-counter-btn" onClick={() => update('piso', data.piso + 1)}>+</button>
                </div>
              </div>

              <div className="pf-field pf-field--price">
                <label className="pf-label">Precio</label>
                <div className="pf-price-input">
                  <span className="pf-currency-symbol">$</span>
                  <input
                    type="text"
                    className="pf-text-input"
                    placeholder="0"
                    value={data.precio}
                    onChange={(e) => update('precio', e.target.value)}
                  />
                  <select className="pf-currency-select" value={data.moneda} onChange={(e) => update('moneda', e.target.value)}>
                    <option>ARS</option>
                    <option>USD</option>
                  </select>
                </div>
              </div>

              <div className="pf-field">
                <label className="pf-label">Ubicación / Dirección</label>
                <div className="pf-input-with-icon">
                  <input
                    type="text"
                    className="pf-text-input"
                    placeholder="Ej. Av. Corrientes 1234"
                    value={data.ubicacion}
                    onChange={(e) => update('ubicacion', e.target.value)}
                  />
                  <svg className="pf-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                </div>
              </div>
            </div>

            <div className="pf-services">
              <label className="pf-label">Servicios</label>
              <div className="pf-checkbox-grid">
                {servicesList.map((svc) => (
                  <label key={svc} className={`pf-checkbox ${data.servicios.includes(svc) ? 'pf-checkbox--checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={data.servicios.includes(svc)}
                      onChange={() => toggleService(svc)}
                      className="sr-only"
                    />
                    <span className="pf-checkbox-box">
                      {data.servicios.includes(svc) && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      )}
                    </span>
                    {svc}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="pf-step">
            <div className="pf-upload-area">
              <UploadBox />
            </div>
          </div>
        )}

        <div className="pf-actions">
          <div></div>
          <Button type="submit">
            {step === TOTAL_STEPS ? 'Tasar' : 'Siguiente'}
            {step < TOTAL_STEPS && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{marginLeft: '0.4rem'}}><polyline points="9 18 15 12 9 6"/></svg>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
};
