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
    <div className="rpt-wrap">
      <div className="rpt-header">
        <button className="rpt-back" onClick={() => window.history.back()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Volver
        </button>
        <div className="rpt-header-center">
          <span className="rpt-prop-name">
            {data ? `Propiedad ${data.direccion}` : 'Reporte de tasación'}
          </span>
          <span className="rpt-prop-id">{report.id}</span>
        </div>
        <span className="rpt-header-logo">
          <img src="/logo.svg" alt="SpatialValue" width="28" height="28" />
        </span>
      </div>

      <div className="rpt-columns">
        <div className="rpt-col-left">
          <div className="rpt-value-card">
            <p className="rpt-value-label">Valor Estimado de la propiedad:</p>
            <p className="rpt-value-amount">{report.valorUsd} USD</p>
          </div>

          <div className="rpt-info-card">
            <p className="rpt-info-text">
              Superficie útil: {data?.superficieCubierta || '—'} m²
              {' · '}Depreciación aplicada: {data?.conservacion === 'Bueno' ? '0%' : data?.conservacion === 'Regular' ? '15%' : '30%'}
              {' · '}Coeficiente de entorno: 1.0
            </p>
          </div>

          <ReportDownloadButton />
        </div>

        <div className="rpt-col-right">
          <div className="rpt-chart-card">
            <h3 className="rpt-chart-title">Valor de m² / Mercado</h3>
            <ValorM2CacChart />
          </div>

          <ReportActions />
        </div>
      </div>

      <div className="rpt-images-section">
        <div className="rpt-images-header">
          <button className="rpt-back" onClick={() => window.history.back()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Volver
          </button>
          <h2 className="rpt-images-title">Análisis de Imágenes</h2>
          <span className="rpt-header-logo">
            <img src="/logo.svg" alt="SpatialValue" width="28" height="28" />
          </span>
        </div>

        <div className="rpt-images-grid">
          <div className="rpt-image-card">
            <div className="rpt-image-placeholder">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </div>
            <div className="rpt-image-status-list">
              <div className="rpt-status-item">
                <span className="rpt-status-dot rpt-status-dot--green"></span>
                <span>Estado de Inmueble: Excelente estado</span>
              </div>
              <div className="rpt-status-item">
                <span className="rpt-status-dot rpt-status-dot--green"></span>
                <span>Estado de Paredes: Buen estado</span>
              </div>
              <div className="rpt-status-item">
                <span className="rpt-status-dot rpt-status-dot--green"></span>
                <span>Estado de Pisos y Techos: Muy buen estado</span>
              </div>
            </div>
          </div>

          <div className="rpt-image-card">
            <div className="rpt-image-placeholder">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </div>
            <div className="rpt-image-status-list">
              <div className="rpt-status-item">
                <span className="rpt-status-dot rpt-status-dot--green"></span>
                <span>Estado de Inmueble: Excelente estado</span>
              </div>
              <div className="rpt-status-item">
                <span className="rpt-status-dot rpt-status-dot--green"></span>
                <span>Estado de Paredes: Buen estado</span>
              </div>
              <div className="rpt-status-item">
                <span className="rpt-status-dot rpt-status-dot--red"></span>
                <span>Estado de Pisos y Techos: Daños visibles / Mal estado</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
