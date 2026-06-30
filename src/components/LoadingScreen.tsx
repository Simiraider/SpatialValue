import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { navigate } from '../lib/navigate';
import '../styles/loading-screen.css';

const steps = [
  'Verificando precios de mercado',
  'Analizando variables macro',
  'Validando datos técnicos',
];

function simularTasacion(data: Record<string, string>) {
  const superficie = Number(data.superficieCubierta) || 80;
  const factorTipo: Record<string, number> = {
    Casa: 1.1,
    Departamento: 1.0,
    Local: 0.9,
    Terreno: 0.7,
  };
  const factorConservacion: Record<string, number> = {
    Bueno: 1.0,
    Regular: 0.85,
    Malo: 0.7,
  };
  const tipo = (data.tipoUnidad || 'Departamento') as keyof typeof factorTipo;
  const conservacion = (data.conservacion || 'Bueno') as keyof typeof factorConservacion;
  const precioM2Base = 1250;

  const valorM2Usd = Math.round(precioM2Base * factorTipo[tipo] * factorConservacion[conservacion]);
  const valorTotalUsd = Math.round(superficie * valorM2Usd);
  const valorTotalArs = Math.round(valorTotalUsd * 1250);

  return {
    id: `SV-${Date.now().toString(36).toUpperCase()}`,
    fecha: new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }),
    direccion: data.direccion || 'Sin especificar',
    ciudad: data.ciudad || '',
    tipoUnidad: tipo,
    superficieCubierta: superficie,
    valorUsd: valorTotalUsd.toLocaleString('es-AR'),
    valorArs: valorTotalArs.toLocaleString('es-AR'),
    valorM2Usd: `${(valorM2Usd / 1000).toFixed(1)}k`,
    conservacion: conservacion,
    dormitorios: data.dormitorios || '2',
    banos: data.banos || '1',
    antiguedadCanherias: data.antiguedadCanherias || '—',
  };
}

export const LoadingScreen = () => {
  const [completed, setCompleted] = useState(0);

  useEffect(() => {
    const timers = steps.map((_, i) =>
      window.setTimeout(() => setCompleted(i + 1), (i + 1) * 1200)
    );

    const redirect = window.setTimeout(() => {
      const draft = sessionStorage.getItem('tasacion-draft');
      if (draft) {
        try {
          const formData = JSON.parse(draft);
          const result = simularTasacion(formData);
          sessionStorage.setItem('tasacion-result', JSON.stringify(result));
        } catch {}
      }

      const redirectUrl = draft
        ? (() => { try {
            const parsed = JSON.parse(draft);
            return parsed.id ? `/reporte?id=${parsed.id}` : '/reporte';
          } catch { return '/reporte'; } })()
        : '/reporte';

      navigate(redirectUrl);
    }, 4500);

    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(redirect);
    };
  }, []);

  return (
    <section className="LoadingScreen">
      <div className="LoadingScreen-spinnerWrap">
        <Loader2 className="LoadingScreen-spinner" />
      </div>
      <h1 className="LoadingScreen-title">Cargando...</h1>
      <ul className="LoadingScreen-steps">
        {steps.map((label, i) => {
          const done = completed > i;
          return (
            <li
              key={label}
              className={done ? 'LoadingScreen-step LoadingScreen-step--done' : 'LoadingScreen-step'}
            >
              {done ? (
                <Check className="LoadingScreen-stepIcon" />
              ) : (
                <span className="LoadingScreen-stepPending" />
              )}
              {label}
            </li>
          );
        })}
      </ul>
    </section>
  );
};



