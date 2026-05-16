import React, { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

const steps = [
  'Verificando precios de mercado',
  'Analizando variables macro',
  'Validando datos técnicos',
];

export const LoadingScreen = () => {
  const [completed, setCompleted] = useState(0);

  useEffect(() => {
    const timers = steps.map((_, i) =>
      window.setTimeout(() => setCompleted(i + 1), (i + 1) * 1200)
    );
    const redirect = window.setTimeout(() => {
      window.location.href = '/reporte';
    }, 4500);

    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(redirect);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
      <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-full border-4 border-primary-100 bg-white shadow-sm">
        <Loader2 className="h-10 w-10 animate-spin text-primary-600" />
      </div>
      <h1 className="text-2xl font-bold text-slate-900">Cargando...</h1>
      <ul className="mt-8 w-full max-w-sm space-y-3">
        {steps.map((label, i) => {
          const done = completed > i;
          return (
            <li
              key={label}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
                done ? 'border-green-200 bg-green-50 text-green-800' : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              {done ? (
                <Check className="h-5 w-5 shrink-0 text-green-600" />
              ) : (
                <span className="h-5 w-5 shrink-0 rounded-full border-2 border-slate-300" />
              )}
              {label}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
