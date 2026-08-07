import { useEffect, useState } from 'react';
import { ValorM2CacChart } from './ReportCharts';
import { ReportActions, ReportDownloadButton } from './ReportActions';
import { Button } from './ui/Button';
import { getUser } from '../lib/session';
import { calcularValores, esAlquiler } from '../lib/tasacion';
import '../styles/reporte.css';

const fmt = (n: number) => Math.round(n).toLocaleString('es-AR');

export const ReportPage = () => {
  const [data, setData] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlId = params.get('id');

      const draftStr = sessionStorage.getItem('tasacion-draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        if (!urlId || urlId === draft.id) {
          setData(draft);
          return;
        }
      }

      setNotFound(true);
    } catch (e) {
      console.error(e);
      setNotFound(true);
    }
  }, []);

  if (notFound) {
    return (
      <div className="ReportePage" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          No encontramos los datos de esta tasación.
        </p>
        <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
          Puede que haya sido creada en otro dispositivo o que el servidor no esté disponible.
        </p>
        <Button type="button" variant="outline" onClick={() => (window.location.href = '/dashboard')}>
          Volver al Dashboard
        </Button>
      </div>
    );
  }

  if (!data) return <div className="ReportePage" style={{padding: '2rem', textAlign: 'center'}}>Cargando reporte...</div>;

  const v = calcularValores(data);
  const alquiler = esAlquiler(data);

  return (
    <div className="ReportePage">
      <header className="ReportePage-header">
        <div className="ReportePage-headerInner">
          <div>
            <p className="ReportePage-meta">
              ID: {data.id || 'N/A'} · {new Date().toLocaleDateString('es-AR')}
            </p>
            <h1 className="ReportePage-title">
              {alquiler ? 'Reporte de tasación locativa' : 'Reporte final'} - {data.direccion}
            </h1>
            <p className="ReportePage-demoBadge" aria-label="Origen de la estimación">
              {v.esIA
                ? 'Estimación generada por el modelo de IA'
                : data.demo
                  ? 'Modo demo: IA no disponible, valor estimado localmente'
                  : 'Estimación basada en datos proporcionados'}
            </p>
          </div>
          <ReportDownloadButton data={data} cliente={getUser()?.nombre} />
        </div>
      </header>

      <main className="ReportePage-main">
        <section className="ReportePage-valueCard">
          <p className="ReportePage-valueLabel">
            {alquiler ? 'Valor locativo mensual estimado' : 'Valor total estimado'}
          </p>
          <p className="ReportePage-valueUsd">
            {alquiler ? `${fmt(v.valorArs)} ARS` : `${fmt(v.valorUsd)} USD`}
          </p>
          <p className="ReportePage-valueArs">
            {alquiler
              ? `${fmt(v.valorUsd)} USD · Expensas ~ $${fmt(v.expensas)}/mes`
              : `${fmt(v.valorArs)} ARS`}
          </p>
        </section>

        {alquiler ? (
          <section className="ReportePage-section">
            <h2 className="ReportePage-sectionTitle">Expensas y servicios</h2>
            <p className="ReportePage-sectionSubtitle">
              {v.expensasDeclaradas > 0
                ? `Expensas mensuales declaradas: $${fmt(v.expensas)} ARS.`
                : `Expensas mensuales estimadas según amenities: $${fmt(v.expensas)} ARS (verificar con la administración).`}
            </p>
            <p className="ReportePage-sectionSubtitle">
              El valor del alquiler no incluye expensas ni servicios (luz, gas, agua/AySA, ABL), que suelen estar a cargo
              del inquilino. Las expensas extraordinarias corresponden al propietario.
            </p>
          </section>
        ) : (
          <section className="ReportePage-section">
            <h2 className="ReportePage-sectionTitle">
              Valor de m² / Comparación con CAC
            </h2>
            <p className="ReportePage-sectionSubtitle">
              {fmt(v.valorM2)} USD/m² estimado
            </p>
            <ValorM2CacChart />
          </section>
        )}

        <section className="ReportePage-section">
          <h2 className="ReportePage-sectionTitle">
            {alquiler ? 'Ofertas de alquiler similares' : 'Propiedades similares'}
          </h2>
          <div className="ReportePage-mapPlaceholder">
            {alquiler
              ? 'Mapa con ofertas de alquiler comparables — integración en sprint posterior.'
              : 'Mapa con comparables — integración en sprint posterior.'}
          </div>
        </section>

        <ReportActions />
      </main>
    </div>
  );
};
