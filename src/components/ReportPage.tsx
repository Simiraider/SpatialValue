import { useEffect, useState } from 'react';
import { ValorM2CacChart } from './ReportCharts';
import { ReportActions, ReportDownloadButton } from './ReportActions';
import { Button } from './ui/Button';
import { getUser, getUsuarioId } from '../lib/session';
import { apiFetch } from '../lib/api';
import { calcularValores, esAlquiler } from '../lib/tasacion';
import { MapaReporte } from './MapaReporte';
import '../styles/reporte.css';

const fmt = (n: number) => Math.round(n).toLocaleString('es-AR');

type ErrorEstado = 'notfound' | 'session' | 'server' | null;

function mapearDesdeDB(p: any) {
  const supCub = Number(p.superficie_cubierta) || 0;
  const supTotal = Number(p.superficie_total) || supCub;

  // Extraer latitud y longitud desde las distintas formas que vengan de la BD
  let lat = p.latitud ? Number(p.latitud) : null;
  let lng = p.longitud ? Number(p.longitud) : null;

  if ((!lat || !lng) && p.coordenadas_gps) {
    try {
      const coords = typeof p.coordenadas_gps === 'string' 
        ? JSON.parse(p.coordenadas_gps) 
        : p.coordenadas_gps;
      lat = Number(coords.lat);
      lng = Number(coords.lng);
    } catch (e) {
      console.warn('Error parseando coordenadas_gps:', e);
    }
  }

  return {
    id: String(p.id_publicacion ?? p.id),
    tipoTasacion: p.tipo_operacion,
    tipo_operacion: p.tipo_operacion,
    direccion: p.direccion || p.titulo || 'Sin dirección',
    barrio: p.barrio || null,
    ciudad: p.ciudad || null,
    superficieCubierta: supCub,
    superficieDescubierta: Math.max(supTotal - supCub, 0),
    superficie_total: supTotal,
    superficie_cubierta: supCub,
    expensas: Number(p.expensas) || 0,
    precioEstimadoUsd: p.precio_estimado_ia != null ? Number(p.precio_estimado_ia) : null,
    comodidades: [],
    demo: false,
    latitud: lat,
    longitud: lng,
  };
}

export const ReportPage = () => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<ErrorEstado>(null);

  const cargar = async () => {
    setData(null);
    setError(null);
    try {
      const params = new URLSearchParams(window.location.search);
      const urlId = params.get('id');

      if (!urlId) {
        const draftStr = sessionStorage.getItem('tasacion-draft');
        if (draftStr) {
          const draft = JSON.parse(draftStr);
          setData(draft);
          return;
        }
        setError('notfound');
        return;
      }

      const usuarioId = getUsuarioId();
      const qs = usuarioId ? `&usuario_id=${encodeURIComponent(usuarioId)}` : '';
      const { ok, status, data: resData } = await apiFetch(
        `/Apis/ObtenerTasacion?id=${encodeURIComponent(urlId)}${qs}`,
        {},
        8000
      );

      if (!ok || !resData) {
        const draftStr = sessionStorage.getItem('tasacion-draft');
        if (draftStr) {
          const draft = JSON.parse(draftStr);
          if (draft.id === urlId) {
            setData(draft);
            return;
          }
        }
        setError(status === 401 ? 'session' : status === 404 ? 'notfound' : 'server');
        return;
      }

      setData(mapearDesdeDB(resData));
    } catch (e) {
      console.error(e);
      setError('server');
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  if (error) {
    return (
      <div className="ReportePage" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          {error === 'session'
            ? 'Tu sesión expiró.'
            : 'No encontramos los datos de esta tasación.'}
        </p>
        <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
          {error === 'session'
            ? 'Volvé a iniciar sesión para ver tus tasaciones.'
            : error === 'server'
              ? 'El servidor no está disponible en este momento.'
              : 'Puede que haya sido creada en otro dispositivo o que el servidor no esté disponible.'}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
          {error === 'server' && (
            <Button type="button" onClick={cargar}>
              Reintentar
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => (window.location.href = error === 'session' ? '/login' : '/dashboard')}
          >
            {error === 'session' ? 'Iniciar sesión' : 'Volver al Dashboard'}
          </Button>
        </div>
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
                  : 'Estimación por método comparativo de mercado (USD/m² de referencia del barrio)'}
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
            <ValorM2CacChart valorM2={v.valorM2} />
          </section>
        )}

        <section className="ReportePage-section">
          <h2 className="ReportePage-sectionTitle">
            {alquiler ? 'Ofertas de alquiler similares' : 'Propiedades similares'}
          </h2>
          <section className="ReportePage-section">
            <h2 className="ReportePage-sectionTitle">
              {alquiler ? 'Ubicación de la propiedad' : 'Ubicación y comparables'}
            </h2>
            <MapaReporte 
              lat={data.latitud} 
              lng={data.longitud} 
              direccion={data.direccion} 
            />
          </section>
        </section>

        <ReportActions />
      </main>
    </div>
  );
};
