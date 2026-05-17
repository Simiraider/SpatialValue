import { useState } from 'react';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { UploadBox } from './UploadBox';
import '../styles/property-form.css';

const TOTAL_STEPS = 4;

const unitTypes = ['Casa', 'Departamento', 'Local', 'Terreno'];

const conservationOptions = [
  { label: 'Bueno', className: 'PropertyForm-conservationOption--good' },
  { label: 'Regular', className: 'PropertyForm-conservationOption--regular' },
  { label: 'Malo', className: 'PropertyForm-conservationOption--bad' },
] as const;

type FormData = {
  // Paso 1 — Ubicación
  direccion: string;
  ciudad: string;
  codigoPostal: string;
  tipoUnidad: string;
  // Paso 2 — Medidas
  superficieCubierta: string;
  superficieSemiCubierta: string;
  descubierta: string;
  ambientes: string;
  dormitorios: string;
  banos: string;
  cocheras: string;
  // Paso 3 — Peritaje
  conservacion: 'Bueno' | 'Regular' | 'Malo';
  calidad: string;
  calefaccion: string;
  antiguedadCanherias: string;
  comentarios: string;
};

type StepErrors = Partial<Record<keyof FormData, string>>;

const initialData: FormData = {
  direccion: '',
  ciudad: '',
  codigoPostal: '',
  tipoUnidad: 'Departamento',
  superficieCubierta: '',
  superficieSemiCubierta: '',
  descubierta: '',
  ambientes: '3',
  dormitorios: '2',
  banos: '1',
  cocheras: '0',
  conservacion: 'Bueno',
  calidad: 'Buena',
  calefaccion: 'Central',
  antiguedadCanherias: 'Menos de 10 años',
  comentarios: '',
};

function validateStep(step: number, data: FormData): StepErrors {
  const errors: StepErrors = {};
  if (step === 1) {
    if (!data.direccion.trim()) errors.direccion = 'La dirección es obligatoria.';
    if (!data.ciudad.trim()) errors.ciudad = 'La ciudad es obligatoria.';
    if (!data.codigoPostal.trim()) errors.codigoPostal = 'El código postal es obligatorio.';
  }
  if (step === 2) {
    if (!data.superficieCubierta || Number(data.superficieCubierta) <= 0)
      errors.superficieCubierta = 'Ingresá la superficie cubierta.';
  }
  return errors;
}

export const PropertyForm = () => {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<FormData>(initialData);
  const [errors, setErrors] = useState<StepErrors>({});

  const progress = (step / TOTAL_STEPS) * 100;

  const update = <K extends keyof FormData>(field: K, value: FormData[K]) =>
    setData((prev) => ({ ...prev, [field]: value }));

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    const stepErrors = validateStep(step, data);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }
    setErrors({});
    if (step < TOTAL_STEPS) {
      setStep((s) => s + 1);
      return;
    }
    // Guardar draft en sessionStorage antes de navegar
    sessionStorage.setItem('tasacion-draft', JSON.stringify(data));
    window.location.href = '/cargando';
  };

  return (
    <form className="PropertyForm" onSubmit={handleNext} noValidate>
      <section className="PropertyForm-progress" aria-label="Progreso">
        <p className="PropertyForm-progressLabel">
          Paso {step}/{TOTAL_STEPS}
        </p>
        <div className="PropertyForm-progressTrack">
          <div
            className="PropertyForm-progressBar"
            style={{ width: `${progress}%` }}
          />
        </div>
      </section>

      {step === 1 && (
        <fieldset className="PropertyForm-fieldset">
          <legend className="sr-only">Ubicación</legend>
          <Input
            label="Dirección Exacta"
            placeholder="Ej. Av. Corrientes 1234"
            value={data.direccion}
            onChange={(e) => update('direccion', e.target.value)}
            error={errors.direccion}
            required
          />
          <Input
            label="Ciudad"
            placeholder="Ej. Buenos Aires"
            value={data.ciudad}
            onChange={(e) => update('ciudad', e.target.value)}
            error={errors.ciudad}
            required
          />
          <Input
            label="Código Postal"
            placeholder="Ej. 1425"
            value={data.codigoPostal}
            onChange={(e) => update('codigoPostal', e.target.value)}
            error={errors.codigoPostal}
            required
          />
          <div>
            <label className="PropertyForm-label">Tipo de Unidad</label>
            <select
              className="PropertyForm-select"
              value={data.tipoUnidad}
              onChange={(e) => update('tipoUnidad', e.target.value)}
            >
              {unitTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div className="PropertyForm-mapPlaceholder">
            Mapa interactivo — se integrará con API de mapas en un sprint posterior.
          </div>
        </fieldset>
      )}

      {step === 2 && (
        <fieldset className="PropertyForm-fieldset PropertyForm-fieldset--grid">
          <legend className="sr-only">Medidas y estructura</legend>
          <Input
            label="Superficie Cubierta (m²)"
            type="number"
            placeholder="Ej. 80"
            value={data.superficieCubierta}
            onChange={(e) => update('superficieCubierta', e.target.value)}
            error={errors.superficieCubierta}
            required
          />
          <Input
            label="Superficie Semi-Cubierta (m²)"
            type="number"
            placeholder="Ej. 10"
            value={data.superficieSemiCubierta}
            onChange={(e) => update('superficieSemiCubierta', e.target.value)}
          />
          <Input
            label="Descubierta (m²)"
            type="number"
            placeholder="Ej. 15"
            value={data.descubierta}
            onChange={(e) => update('descubierta', e.target.value)}
          />
          <div>
            <label className="PropertyForm-label">Cantidad de Ambientes</label>
            <select
              className="PropertyForm-select"
              value={data.ambientes}
              onChange={(e) => update('ambientes', e.target.value)}
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="PropertyForm-label">Dormitorios</label>
            <select
              className="PropertyForm-select"
              value={data.dormitorios}
              onChange={(e) => update('dormitorios', e.target.value)}
            >
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="PropertyForm-label">Baños</label>
            <select
              className="PropertyForm-select"
              value={data.banos}
              onChange={(e) => update('banos', e.target.value)}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="PropertyForm-label">Cocheras</label>
            <select
              className="PropertyForm-select"
              value={data.cocheras}
              onChange={(e) => update('cocheras', e.target.value)}
            >
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
      )}

      {step === 3 && (
        <fieldset className="PropertyForm-fieldset PropertyForm-fieldset--spaced">
          <legend className="sr-only">Peritaje técnico</legend>
          <div>
            <label className="PropertyForm-label PropertyForm-label--group">
              Estado de Conservación
            </label>
            <div className="PropertyForm-conservationGroup">
              {conservationOptions.map((opt) => (
                <label
                  key={opt.label}
                  className={`PropertyForm-conservationOption ${opt.className}${
                    data.conservacion === opt.label ? ' PropertyForm-conservationOption--selected' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="conservacion"
                    value={opt.label}
                    className="sr-only"
                    checked={data.conservacion === opt.label}
                    onChange={() =>
                      update('conservacion', opt.label as FormData['conservacion'])
                    }
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="PropertyForm-label">Calidad de aberturas</label>
            <select
              className="PropertyForm-select"
              value={data.calidad}
              onChange={(e) => update('calidad', e.target.value)}
            >
              <option>Buena</option>
              <option>Regular</option>
              <option>Mala</option>
            </select>
          </div>
          <div>
            <label className="PropertyForm-label">Tipo de Calefacción</label>
            <select
              className="PropertyForm-select"
              value={data.calefaccion}
              onChange={(e) => update('calefaccion', e.target.value)}
            >
              <option>Central</option>
              <option>Individual</option>
              <option>Sin calefacción</option>
              <option>Aire acondicionado</option>
            </select>
          </div>
          <div>
            <label className="PropertyForm-label">Antigüedad de Cañerías</label>
            <select
              className="PropertyForm-select"
              value={data.antiguedadCanherias}
              onChange={(e) => update('antiguedadCanherias', e.target.value)}
            >
              <option>Menos de 10 años</option>
              <option>10–20 años</option>
              <option>Más de 20 años</option>
            </select>
          </div>
          <div>
            <label className="PropertyForm-label">Comentarios Adicionales</label>
            <textarea
              className="PropertyForm-textarea"
              placeholder="Observaciones sobre la estructura..."
              value={data.comentarios}
              onChange={(e) => update('comentarios', e.target.value)}
            />
          </div>
        </fieldset>
      )}

      {step === 4 && (
        <fieldset className="PropertyForm-fieldset">
          <legend className="sr-only">Multimedia</legend>
          <p className="PropertyForm-hint">
            Fotos de fachada o ambientes (opcional). Subir imágenes mejora la precisión del algoritmo en futuros
            sprints.
          </p>
          <UploadBox />
        </fieldset>
      )}

      <div className="PropertyForm-actions">
        {step > 1 ? (
          <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
            Anterior
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={() => (window.location.href = '/dashboard')}>
            Cancelar
          </Button>
        )}
        <Button type="submit" className="PropertyForm-submit">
          {step === TOTAL_STEPS ? 'Finalizar y Calcular' : 'Siguiente'}
        </Button>
      </div>
    </form>
  );
};
