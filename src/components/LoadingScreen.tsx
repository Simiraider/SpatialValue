import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { navegarA, esIdSeguro } from '../lib/navigate';
import '../styles/loading-screen.css';

const steps = [
  'Verificando precios de mercado',
  'Analizando variables macro',
  'Validando datos técnicos',
];

const MINIMO_VISIBLE_MS = 3600;

export const LoadingScreen = () => {
  const [completed, setCompleted] = useState(0);

  useEffect(() => {
    const inicio = Date.now();
    const timers = steps.map((_, i) =>
      window.setTimeout(() => setCompleted(i + 1), (i + 1) * 1200)
    );

    let redirectTimer: number | null = null;
    const irAlReporte = (id: string, extraDelay = 0) => {
      const restante = Math.max(0, MINIMO_VISIBLE_MS - (Date.now() - inicio)) + extraDelay;
      redirectTimer = window.setTimeout(() => navegarA('/reporte', { id }), restante);
    };

    const pollInterval = window.setInterval(() => {
      try {
        const draftStr = sessionStorage.getItem('tasacion-draft');
        if (draftStr) {
          const draft = JSON.parse(draftStr);
          if (draft.id && esIdSeguro(draft.id) && !draft.demo) {
            window.clearInterval(pollInterval);
            irAlReporte(draft.id);
            return;
          }
          if (draft.id && esIdSeguro(draft.id) && draft.demo) {
            window.clearInterval(pollInterval);
            irAlReporte(draft.id, 1500);
            return;
          }
        }
      } catch (e) {}
    }, 500);

    const timeoutFinal = window.setTimeout(() => {
      window.clearInterval(pollInterval);
      try {
        const draftStr = sessionStorage.getItem('tasacion-draft');
        if (draftStr) {
          const draft = JSON.parse(draftStr);
          if (draft.id && esIdSeguro(draft.id)) {
            navegarA('/reporte', { id: draft.id });
            return;
          }
        }
      } catch (e) {}
      navegarA('/reporte');
    }, 15000);

    return () => {
      timers.forEach(clearTimeout);
      window.clearInterval(pollInterval);
      clearTimeout(timeoutFinal);
      if (redirectTimer !== null) clearTimeout(redirectTimer);
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
