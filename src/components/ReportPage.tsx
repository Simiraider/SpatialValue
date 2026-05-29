import { useEffect, useState } from 'react';
import { ValorM2CacChart } from './ReportCharts';
import { ReportActions, ReportDownloadButton } from './ReportActions';
import '../styles/reporte.css';

export const ReportPage = () => {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    try {
      const draftStr = sessionStorage.getItem('tasacion-draft');
      if (draftStr) {
        setData(JSON.parse(draftStr));
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  if (!data) return <div className="ReportePage" style={{padding: '2rem', textAlign: 'center'}}>Cargando reporte...</div>;

  const valorEstimadoUsd = (Number(data.superficieCubierta) * 2500) || 0;
  const valorEstimadoArs = valorEstimadoUsd * 1000;

  return (
    <div className="ReportePage">
      <header className="ReportePage-header">
        <div className="ReportePage-headerInner">
          <div>
            <p className="ReportePage-meta">
              ID: {data.id || 'N/A'} · {new Date().toLocaleDateString('es-AR')}
            </p>
            <h1 className="ReportePage-title">Reporte final - {data.direccion}</h1>
            <p className="ReportePage-demoBadge" aria-label="Modo demostración">
              Estimación basada en datos proporcionados
            </p>
          </div>
          <ReportDownloadButton />
        </div>
      </header>

      <main className="ReportePage-main">
        <section className="ReportePage-valueCard">
          <p className="ReportePage-valueLabel">Valor total estimado</p>
          <p className="ReportePage-valueUsd">
            {valorEstimadoUsd.toLocaleString('es-AR')} USD
          </p>
          <p className="ReportePage-valueArs">
            {valorEstimadoArs.toLocaleString('es-AR')} ARS
          </p>
        </section>

        <section className="ReportePage-section">
          <h2 className="ReportePage-sectionTitle">
            Valor de m² / Comparación con CAC
          </h2>
          <p className="ReportePage-sectionSubtitle">
            2.500 USD/m² estimado
          </p>
          <ValorM2CacChart />
        </section>

        <section className="ReportePage-section">
          <h2 className="ReportePage-sectionTitle">Propiedades similares</h2>
          <div className="ReportePage-mapPlaceholder">
            Mapa con comparables — integración en sprint posterior.
          </div>
        </section>

        <ReportActions />
      </main>
    </div>
  );
};
