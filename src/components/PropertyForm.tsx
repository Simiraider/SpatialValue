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

export const PropertyForm = () => {
  const [step, setStep] = useState(1);

  const progress = (step / TOTAL_STEPS) * 100;

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
      return;
    }
    window.location.href = '/cargando';
  };

  return (
    <form className="PropertyForm" onSubmit={handleNext}>
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
          <Input label="Dirección Exacta" placeholder="Ej. Av. Corrientes 1234" required />
          <Input label="Ciudad" placeholder="Ej. Buenos Aires" required />
          <Input label="Código Postal" placeholder="Ej. 1425" required />
          <div>
            <label className="PropertyForm-label">Tipo de Unidad</label>
            <select className="PropertyForm-select" defaultValue="Departamento" required>
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
          <Input label="Superficie Cubierta (m²)" type="number" placeholder="Ej. 80" required />
          <Input label="Superficie Semi-Cubierta (m²)" type="number" placeholder="Ej. 10" />
          <Input label="Descubierta (m²)" type="number" placeholder="Ej. 15" />
          <div>
            <label className="PropertyForm-label">Cantidad de Ambientes</label>
            <select className="PropertyForm-select" defaultValue="3">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="PropertyForm-label">Dormitorios</label>
            <select className="PropertyForm-select" defaultValue="2">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="PropertyForm-label">Baños</label>
            <select className="PropertyForm-select" defaultValue="1">
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="PropertyForm-label">Cocheras</label>
            <select className="PropertyForm-select" defaultValue="0">
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
                  className={`PropertyForm-conservationOption ${opt.className}`}
                >
                  <input
                    type="radio"
                    name="conservacion"
                    value={opt.label}
                    className="sr-only"
                    defaultChecked={opt.label === 'Bueno'}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="PropertyForm-label">Calidad de aberturas</label>
            <select className="PropertyForm-select" defaultValue="Buena">
              <option>Buena</option>
              <option>Regular</option>
              <option>Mala</option>
            </select>
          </div>
          <div>
            <label className="PropertyForm-label">Tipo de Calefacción</label>
            <select className="PropertyForm-select" defaultValue="Central">
              <option>Central</option>
              <option>Individual</option>
              <option>Sin calefacción</option>
              <option>Aire acondicionado</option>
            </select>
          </div>
          <div>
            <label className="PropertyForm-label">Antigüedad de Cañerías</label>
            <select className="PropertyForm-select" defaultValue="Menos de 10 años">
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

