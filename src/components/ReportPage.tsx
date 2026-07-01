import { useEffect, useState } from 'react';
import { ReportActions, ReportDownloadButton } from './ReportActions';
import { ValorM2CacChart } from './ReportCharts';
import { reporteMock } from '../data/mock';
import '../styles/reporte.css';

type ReportData = {
  id: string;
  fecha: string;
  direccion: string;
  ciudad: string;
  tipoUnidad: string;
  superficieCubierta: number;
  valorUsd: string;
  valorArs: string;
  valorM2Usd: string;
  conservacion: string;
  dormitorios: string;
  banos: string;
  antiguedadCanherias: string;
};

export const ReportPage = () => {
  const [data, setData] = useState<ReportData | null>(null);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('tasacion-result');
      if (stored) {
        setData(JSON.parse(stored));
      }
    } catch {}
  }, []);

  const report = data ?? reporteMock;

  return (
    <div className="ReportePage">
      <header className="ReportePage-header">
        <div className="ReportePage-headerInner">
          <div>
            <p className="ReportePage-meta">
              ID: {report.id} · {report.fecha}
            </p>
            <h1 className="ReportePage-title">
              {data ? `Reporte — ${data.direccion}` : 'Reporte final'}
            </h1>
            {data && (
              <p className="ReportePage-subtitle">
                {data.tipoUnidad} · {data.superficieCubierta} m² · {data.dormitorios} dorm. · {data.banos} baños
              </p>
            )}
            {!data && (
              <p className="ReportePage-demoBadge" aria-label="Modo demostración">
                ⚠ Datos de demostración
              </p>
            )}
          </div>
          <ReportDownloadButton />
        </div>
      </header>

      <main className="ReportePage-main">
        <section className="ReportePage-valueCard">
          <p className="ReportePage-valueLabel">Valor total</p>
          <p className="ReportePage-valueUsd">
            {report.valorUsd} USD
          </p>
          <p className="ReportePage-valueArs">
            {report.valorArs} ARS
          </p>
        </section>

        <section className="ReportePage-section">
          <h2 className="ReportePage-sectionTitle">
            Valor de m² / Comparación con CAC
          </h2>
          <p className="ReportePage-sectionSubtitle">
            {report.valorM2Usd} USD/m² estimado
          </p>
          <ValorM2CacChart />
        </section>

        {data && (
          <section className="ReportePage-section">
            <h2 className="ReportePage-sectionTitle">Detalles de la propiedad</h2>
            <dl className="ReportePage-details">
              <div className="ReportePage-detailRow">
                <dt>Dirección</dt>
                <dd>{data.direccion}</dd>
              </div>
              <div className="ReportePage-detailRow">
                <dt>Ciudad</dt>
                <dd>{data.ciudad}</dd>
              </div>
              <div className="ReportePage-detailRow">
                <dt>Tipo</dt>
                <dd>{data.tipoUnidad}</dd>
              </div>
              <div className="ReportePage-detailRow">
                <dt>Superficie</dt>
                <dd>{data.superficieCubierta} m²</dd>
              </div>
              <div className="ReportePage-detailRow">
                <dt>Conservación</dt>
                <dd>{data.conservacion}</dd>
              </div>
              <div className="ReportePage-detailRow">
                <dt>Dormitorios</dt>
                <dd>{data.dormitorios}</dd>
              </div>
              <div className="ReportePage-detailRow">
                <dt>Baños</dt>
                <dd>{data.banos}</dd>
              </div>
              <div className="ReportePage-detailRow">
                <dt>Cañerías</dt>
                <dd>{data.antiguedadCanherias}</dd>
              </div>
            </dl>
          </section>
        )}

        <section className="ReportePage-section">
          <h2 className="ReportePage-sectionTitle">Propiedades similares</h2>
          <div className="ReportePage-mapPlaceholder">
            Mapa con comparables — integración en sprint posterior (scraping / API).
          </div>
        </section>

        <ReportActions />
      </main>
    </div>
  );
};
