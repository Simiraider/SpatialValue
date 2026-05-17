import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import '../styles/loading-screen.css';

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



