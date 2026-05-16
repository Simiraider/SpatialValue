import React, { useState } from 'react';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { UploadBox } from './UploadBox';
import { cn } from '../lib/utils';

const TOTAL_STEPS = 4;

const unitTypes = ['Casa', 'Departamento', 'Local', 'Terreno'];

const selectClass =
  'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600';

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
    <form className="space-y-8" onSubmit={handleNext}>
      <section className="space-y-2" aria-label="Progreso">
        <p className="text-sm font-medium text-slate-600">
          Paso {step}/{TOTAL_STEPS}
        </p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-primary-600 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </section>

      {step === 1 && (
        <fieldset className="space-y-4">
          <legend className="sr-only">Ubicación</legend>
          <Input label="Dirección Exacta" placeholder="Ej. Av. Corrientes 1234" required />
          <Input label="Ciudad" placeholder="Ej. Buenos Aires" required />
          <Input label="Código Postal" placeholder="Ej. 1425" required />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Tipo de Unidad</label>
            <select className={selectClass} defaultValue="Departamento" required>
              {unitTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
            Mapa interactivo — se integrará con API de mapas en un sprint posterior.
          </div>
        </fieldset>
      )}

      {step === 2 && (
        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <legend className="sr-only">Medidas y estructura</legend>
          <Input label="Superficie Cubierta (m²)" type="number" placeholder="Ej. 80" required />
          <Input label="Superficie Semi-Cubierta (m²)" type="number" placeholder="Ej. 10" />
          <Input label="Descubierta (m²)" type="number" placeholder="Ej. 15" />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Cantidad de Ambientes</label>
            <select className={selectClass} defaultValue="3">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Dormitorios</label>
            <select className={selectClass} defaultValue="2">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Baños</label>
            <select className={selectClass} defaultValue="1">
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Cocheras</label>
            <select className={selectClass} defaultValue="0">
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
        <fieldset className="space-y-5">
          <legend className="sr-only">Peritaje técnico</legend>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Estado de Conservación</label>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Bueno', color: 'border-green-500 bg-green-50 text-green-800' },
                { label: 'Regular', color: 'border-amber-500 bg-amber-50 text-amber-800' },
                { label: 'Malo', color: 'border-red-500 bg-red-50 text-red-800' },
              ].map((opt) => (
                <label
                  key={opt.label}
                  className={cn(
                    'cursor-pointer rounded-lg border-2 px-4 py-2 text-sm font-medium has-[:checked]:ring-2 has-[:checked]:ring-primary-600',
                    opt.color
                  )}
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
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Calidad de aberturas</label>
            <select className={selectClass} defaultValue="Buena">
              <option>Buena</option>
              <option>Regular</option>
              <option>Mala</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Tipo de Calefacción</label>
            <select className={selectClass} defaultValue="Central">
              <option>Central</option>
              <option>Individual</option>
              <option>Sin calefacción</option>
              <option>Aire acondicionado</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Antigüedad de Cañerías</label>
            <select className={selectClass} defaultValue="Menos de 10 años">
              <option>Menos de 10 años</option>
              <option>10–20 años</option>
              <option>Más de 20 años</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Comentarios Adicionales</label>
            <textarea
              className="min-h-[100px] w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
              placeholder="Observaciones sobre la estructura..."
            />
          </div>
        </fieldset>
      )}

      {step === 4 && (
        <fieldset className="space-y-4">
          <legend className="sr-only">Multimedia</legend>
          <p className="text-sm text-slate-600">
            Fotos de fachada o ambientes (opcional). Subir imágenes mejora la precisión del algoritmo en futuros
            sprints.
          </p>
          <UploadBox />
        </fieldset>
      )}

      <div className="flex justify-between gap-3 pt-4">
        {step > 1 ? (
          <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
            Anterior
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={() => (window.location.href = '/dashboard')}>
            Cancelar
          </Button>
        )}
        <Button type="submit" className="ml-auto">
          {step === TOTAL_STEPS ? 'Finalizar y Calcular' : 'Siguiente'}
        </Button>
      </div>
    </form>
  );
};

