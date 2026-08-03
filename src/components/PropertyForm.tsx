import React, { useState } from 'react';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { navigate } from '../lib/navigate';
import { cn } from '../lib/utils';

const TOTAL_STEPS = 3;
const AMENITIES_LIST = ["Pileta", "SUM", "Parrilla", "Cochera", "Gimnasio", "Balcón", "Patio", "Seguridad 24h"];

type FormData = {
  direccion: string;
  ciudad: string;
  tipoUnidad: 'Casa' | 'Departamento';
  superficieCubierta: string;
  superficieDescubierta: string;
  ambientes: string;
  piso: string;
  luzNatural: 'Mucha' | 'Regular' | 'Poca' | '';
  comodidades: string[];
  estadoGeneral: number;
};

const initialData: FormData = {
  direccion: '',
  ciudad: '',
  tipoUnidad: 'Departamento',
  superficieCubierta: '',
  superficieDescubierta: '',
  ambientes: '3',
  piso: '',
  luzNatural: '',
  comodidades: [],
  estadoGeneral: 7,
};

function validateStep(step: number, data: FormData): Record<string, string> {
  const errors: Record<string, string> = {};
  if (step === 1) {
    if (!data.direccion.trim()) errors.direccion = 'Requerido';
    if (!data.ciudad.trim()) errors.ciudad = 'Requerido';
    if (!data.superficieCubierta || Number(data.superficieCubierta) <= 0) errors.superficieCubierta = 'Requerido';
    if (data.tipoUnidad === 'Departamento') {
      if (!data.piso.trim()) errors.piso = 'Requerido';
      if (!data.luzNatural) errors.luzNatural = 'Requerido';
    }
  }
  return errors;
}

export const PropertyForm = () => {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<FormData>(initialData);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = <K extends keyof FormData>(field: K, value: FormData[K]) =>
    setData((prev) => ({ ...prev, [field]: value }));

  const toggleAmenity = (amenity: string) => {
    setData(prev => ({
      ...prev,
      comodidades: prev.comodidades.includes(amenity)
        ? prev.comodidades.filter(a => a !== amenity)
        : [...prev.comodidades, amenity]
    }));
  };

  const handleNext = async (e: React.FormEvent) => {
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

    try {
      const getCookie = (name: string) => {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop()?.split(';').shift();
        return null;
      };

      const usuarioId = getCookie('usuario_id') || 'demo-user';

      const body = {
        titulo: `${data.tipoUnidad} en ${data.direccion}`,
        descripcion: `Tasación automática. Comodidades: ${data.comodidades.join(', ')}`,
        precio: 0,
        direccion: data.direccion,
        ciudad: data.ciudad,
        habitaciones: Number(data.ambientes),
        area_m2: Number(data.superficieCubierta),
        piso: data.piso,
        luzNatural: data.luzNatural,
        comodidades: data.comodidades,
        estadoGeneral: data.estadoGeneral,
        usuario_id: usuarioId
      };

      const res = await fetch('/Apis/PublicarPropiedad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const resData = await res.json().catch(() => null);

      if (res.ok && resData?.success) {
        sessionStorage.setItem('tasacion-draft', JSON.stringify({ ...data, id: resData.data.id }));
        navigate('/cargando');
      } else {
        // Fallback demo
        sessionStorage.setItem('tasacion-draft', JSON.stringify({ ...data, id: 'demo-123' }));
        navigate('/cargando');
      }
    } catch (error) {
      console.error(error);
      sessionStorage.setItem('tasacion-draft', JSON.stringify({ ...data, id: 'demo-123' }));
      navigate('/cargando');
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto py-8">
      {/* Progress Indicator */}
      <div className="flex items-center justify-center mb-8">
        {[1, 2, 3].map((s, i) => (
          <React.Fragment key={s}>
            <div className="flex flex-col items-center">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-colors",
                step >= s ? "bg-teal-500 text-white shadow-md" : "bg-slate-200 text-slate-500"
              )}>
                {s}
              </div>
            </div>
            {i < 2 && (
              <div className={cn(
                "h-1 w-16 sm:w-24 mx-2 rounded transition-colors",
                step > s ? "bg-teal-500" : "bg-slate-200"
              )} />
            )}
          </React.Fragment>
        ))}
      </div>

      <Card>
        <form onSubmit={handleNext} noValidate className="space-y-6">
          
          {step === 1 && (
            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
              <h2 className="text-xl font-bold text-slate-800 mb-6">Datos Básicos</h2>
              
              <div className="flex gap-4 mb-4">
                <Button 
                  type="button"
                  variant={data.tipoUnidad === 'Casa' ? 'secondary' : 'outline'}
                  fullWidth
                  onClick={() => update('tipoUnidad', 'Casa')}
                >
                  🏡 Casa
                </Button>
                <Button 
                  type="button"
                  variant={data.tipoUnidad === 'Departamento' ? 'secondary' : 'outline'}
                  fullWidth
                  onClick={() => update('tipoUnidad', 'Departamento')}
                >
                  🏢 Departamento
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Dirección"
                  placeholder="Av. Corrientes 1234"
                  value={data.direccion}
                  onChange={(e) => update('direccion', e.target.value)}
                  error={errors.direccion}
                />
                <Input
                  label="Ciudad / Barrio"
                  placeholder="Buenos Aires"
                  value={data.ciudad}
                  onChange={(e) => update('ciudad', e.target.value)}
                  error={errors.ciudad}
                />
                <Input
                  label="Superficie Cubierta (m²)"
                  type="number"
                  placeholder="Ej. 80"
                  value={data.superficieCubierta}
                  onChange={(e) => update('superficieCubierta', e.target.value)}
                  error={errors.superficieCubierta}
                />
                <Input
                  label="Superficie Descubierta (m²)"
                  type="number"
                  placeholder="Ej. 10"
                  value={data.superficieDescubierta}
                  onChange={(e) => update('superficieDescubierta', e.target.value)}
                />
                
                <div className="flex flex-col space-y-1.5 w-full">
                  <label className="text-sm font-medium text-slate-700 ml-1">Ambientes</label>
                  <select 
                    className="flex h-12 w-full rounded-2xl bg-slate-50 px-4 py-2 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 border-none"
                    value={data.ambientes}
                    onChange={(e) => update('ambientes', e.target.value)}
                  >
                    {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>

                {data.tipoUnidad === 'Departamento' && (
                  <>
                    <Input
                      label="Altura del Piso"
                      placeholder="Ej. 5"
                      value={data.piso}
                      onChange={(e) => update('piso', e.target.value)}
                      error={errors.piso}
                    />
                    <div className="flex flex-col space-y-1.5 w-full">
                      <label className="text-sm font-medium text-slate-700 ml-1">Luz Natural</label>
                      <select 
                        className={cn(
                          "flex h-12 w-full rounded-2xl bg-slate-50 px-4 py-2 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 border-none",
                          errors.luzNatural && "ring-2 ring-red-500 focus:ring-red-500"
                        )}
                        value={data.luzNatural}
                        onChange={(e) => update('luzNatural', e.target.value as FormData['luzNatural'])}
                      >
                        <option value="">Seleccionar...</option>
                        <option value="Mucha">Mucha (Muy luminoso)</option>
                        <option value="Regular">Regular</option>
                        <option value="Poca">Poca (Interno/Oscuro)</option>
                      </select>
                      {errors.luzNatural && <p className="text-sm text-red-500 ml-1">{errors.luzNatural}</p>}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
              <h2 className="text-xl font-bold text-slate-800 mb-2">Comodidades y Extras</h2>
              <p className="text-slate-500 mb-6 text-sm">Seleccioná todo lo que tenga la propiedad.</p>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {AMENITIES_LIST.map(amenity => (
                  <button
                    key={amenity}
                    type="button"
                    onClick={() => toggleAmenity(amenity)}
                    className={cn(
                      "p-3 rounded-2xl border-2 transition-all flex items-center justify-center font-medium",
                      data.comodidades.includes(amenity)
                        ? "border-cyan-500 bg-cyan-50 text-cyan-700"
                        : "border-slate-100 bg-slate-50 text-slate-600 hover:border-slate-300"
                    )}
                  >
                    {amenity}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
              <h2 className="text-xl font-bold text-slate-800 mb-2">Estado General</h2>
              <p className="text-slate-500 mb-6 text-sm">Del 1 al 10, ¿cómo calificarías el estado de conservación de la propiedad?</p>
              
              <div className="py-8 px-4 bg-slate-50 rounded-3xl flex flex-col items-center">
                <div className="text-5xl font-bold text-cyan-600 mb-6">{data.estadoGeneral}</div>
                <input 
                  type="range" 
                  min="1" 
                  max="10" 
                  value={data.estadoGeneral} 
                  onChange={(e) => update('estadoGeneral', Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-teal-500"
                />
                <div className="flex justify-between w-full mt-4 text-sm font-medium text-slate-400">
                  <span>1 (A refaccionar)</span>
                  <span>10 (A estrenar)</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-4 pt-6 mt-6 border-t border-slate-100">
            {step > 1 ? (
              <Button type="button" variant="outline" className="w-1/3" onClick={() => setStep(step - 1)}>
                Atrás
              </Button>
            ) : (
              <Button type="button" variant="ghost" className="w-1/3" onClick={() => navigate('/dashboard')}>
                Cancelar
              </Button>
            )}
            <Button type="submit" variant="primary" className="flex-1 bg-slate-900 text-white hover:bg-slate-800">
              {step === TOTAL_STEPS ? 'Finalizar y Calcular' : 'Siguiente paso'}
            </Button>
          </div>

        </form>
      </Card>
    </div>
  );
};
