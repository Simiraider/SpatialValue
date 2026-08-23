import React, { useEffect, useState, Component, type ReactNode } from 'react';
import { ValorM2CacChart } from './ReportCharts';
import { ReportActions, ReportDownloadButton } from './ReportActions';
import { Button } from './ui/Button';
import { getUser, getUsuarioId } from '../lib/session';
import { apiFetch } from '../lib/api';
import { calcularValores, esAlquiler } from '../lib/tasacion';
import { MapaReporte } from './MapaReporte';
import '../styles/reporte.css';

class RenderErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

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

  // Extraer detalles del JSONB si existen
  let det: Record<string, any> = {};
  try {
    det = typeof p.detalles === 'string' ? JSON.parse(p.detalles) : (p.detalles && typeof p.detalles === 'object' ? p.detalles : {});
  } catch { det = {}; }

  return {
    id: String(p.id_publicacion ?? p.id),
    tipoTasacion: p.tipo_operacion,
    tipo_operacion: p.tipo_operacion,
    tipoUnidad: p.tipo_propiedad ?? 'Departamento',
    direccion: p.direccion || p.titulo || 'Sin dirección',
    barrio: p.barrio || null,
    ciudad: p.ciudad || null,
    superficieCubierta: supCub,
    superficieDescubierta: Math.max(supTotal - supCub, 0),
    superficie_total: supTotal,
    superficie_cubierta: supCub,
    ambientes: p.ambientes ?? det.ambientes ?? null,
    dormitorios: p.dormitorios ?? det.dormitorios ?? null,
    banos: p.banos ?? det.banos ?? null,
    piso: p.piso ?? det.piso ?? null,
    antiguedad: det.antiguedad ?? null,
    orientacion: det.orientacion ?? null,
    disposicion: det.disposicion ?? null,
    estadoGeneral: det.estadoGeneral ?? null,
    expensas: Number(p.expensas) || 0,
    precioEstimadoUsd: p.precio_estimado_ia != null ? Number(p.precio_estimado_ia) : null,
    comodidades: Array.isArray(det.comodidades) ? det.comodidades : [],
    fotos: Array.isArray(det.fotos) ? det.fotos : [],
    demo: false,
    latitud: lat,
    longitud: lng,
  };
}

function normalizeData(raw: any): Record<string, any> | null {
  if (!raw || typeof raw !== 'object') return null;
  // Si viene de la DB (tiene id_publicacion), usar mapearDesdeDB
  if (raw.id_publicacion != null) return mapearDesdeDB(raw);
  // Si viene del draft de sessionStorage
  try {
    const supCub = Number(raw.superficieCubierta ?? raw.superficie_cubierta) || 0;
    const supTotal = Number(raw.superficie_total ?? raw.superficieTotal) || supCub;
    let det: Record<string, any> = {};
    try {
      det = typeof raw.detalles === 'string' ? JSON.parse(raw.detalles) : (raw.detalles && typeof raw.detalles === 'object' ? raw.detalles : {});
    } catch { det = {}; }
    return {
      id: String(raw.id ?? raw.id_publicacion ?? 'N/A'),
      tipoTasacion: raw.tipoTasacion ?? raw.tipo_operacion ?? 'venta',
      tipo_operacion: raw.tipo_operacion ?? raw.tipoTasacion ?? 'venta',
      tipoUnidad: raw.tipoUnidad ?? raw.tipo_propiedad ?? 'Departamento',
      direccion: raw.direccion || raw.titulo || 'Sin dirección',
      barrio: raw.barrio ?? det.barrio ?? null,
      ciudad: raw.ciudad ?? det.ciudad ?? 'Ciudad de Buenos Aires',
      superficieCubierta: supCub, superficieTotal: supTotal,
      superficieDescubierta: Number(raw.superficieDescubierta) || Math.max(supTotal - supCub, 0),
      superficie_total: supTotal, superficie_cubierta: supCub,
      ambientes: raw.ambientes ?? det.ambientes ?? null,
      dormitorios: raw.dormitorios ?? det.dormitorios ?? null,
      banos: raw.banos ?? det.banos ?? null, piso: raw.piso ?? det.piso ?? null,
      antiguedad: raw.antiguedad ?? det.antiguedad ?? null,
      orientacion: raw.orientacion ?? det.orientacion ?? null,
      disposicion: raw.disposicion ?? det.disposicion ?? null,
      estadoGeneral: raw.estadoGeneral ?? det.estadoGeneral ?? null,
      expensas: Number(raw.expensas) || 0,
      precioEstimadoUsd: raw.precioEstimadoUsd != null ? Number(raw.precioEstimadoUsd) : raw.precio_estimado_ia != null ? Number(raw.precio_estimado_ia) : null,
      comodidades: Array.isArray(raw.comodidades) ? raw.comodidades : (Array.isArray(det.comodidades) ? det.comodidades : []),
      fotos: Array.isArray(raw.fotos) ? raw.fotos : (Array.isArray(det.fotos) ? det.fotos : []),
      demo: Boolean(raw.demo), coordenadas: raw.coordenadas ?? null,
    };
  } catch {
    return null;
  }
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

      // 1) Intentar leer del draft de sessionStorage primero
      const draftStr = sessionStorage.getItem('tasacion-draft');
      if (draftStr) {
        try {
          const draft = JSON.parse(draftStr);
          if (!urlId || String(draft.id) === String(urlId)) {
            const normalized = normalizeData(draft);
            if (normalized) { setData(normalized); return; }
          }
        } catch (e) { console.error('[ReportPage] draft parse error:', e); }
      }

      // 2) No hay draft o no matchea → intentar la API
      if (!urlId) {
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
        setError(status === 401 ? 'session' : status === 404 ? 'notfound' : 'server');
        return;
      }

      const normalized = normalizeData(resData);
      if (normalized) {
        setData(normalized);
      } else {
        setError('notfound');
      }
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

  if (!data) return <div className="ReportePage" style={{padding: '4rem 2rem', textAlign: 'center'}}><p style={{fontSize:'1.25rem',color:'#64748b'}}>Cargando reporte…</p></div>;

  let v;
  try {
    v = calcularValores(data);
  } catch (e) {
    console.error('[ReportPage] calcularValores error:', e);
    return (
      <div className="ReportePage" style={{padding:'4rem 2rem',textAlign:'center'}}>
        <p style={{fontSize:'1.25rem',fontWeight:600}}>Error al procesar los datos de la tasación.</p>
        <p style={{color:'#64748b',marginTop:'.5rem'}}>Los datos se recibieron pero no pudieron procesarse correctamente.</p>
        <Button type="button" onClick={() => window.location.reload()} style={{marginTop:'1rem'}}>Recargar</Button>
      </div>
    );
  }
  const alquiler = esAlquiler(data);

  return (
    <RenderErrorBoundary fallback={<div className="ReportePage" style={{padding:'4rem 2rem',textAlign:'center'}}><p style={{fontSize:'1.25rem',fontWeight:600}}>Hubo un error al renderizar el reporte.</p><p style={{color:'#64748b',marginTop:'.5rem'}}>Los datos se cargaron pero algo falló al dibujarlos.</p><Button type="button" onClick={()=>window.location.reload()} style={{marginTop:'1rem'}}>Recargar</Button></div>}>
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

        <section className="ReportePage-section">
          <h2 className="ReportePage-sectionTitle">Datos de la propiedad</h2>
          <div className="ReportePage-facts">
            <div><span>Barrio</span><strong>{data.barrio || data.ciudad || '—'}</strong></div>
            <div><span>Tipo</span><strong>{data.tipoUnidad || '—'}</strong></div>
            <div><span>Superficie total</span><strong>{fmt(v.supTotal)} m²</strong></div>
            <div><span>Superficie cubierta</span><strong>{fmt(v.supCub)} m²</strong></div>
            <div><span>Antigüedad</span><strong>{data.antiguedad ? `${data.antiguedad} años` : '—'}</strong></div>
            <div><span>Ambientes</span><strong>{data.ambientes ?? '—'}</strong></div>
            <div><span>Dormitorios</span><strong>{data.dormitorios ?? '—'}</strong></div>
            <div><span>Baños</span><strong>{data.banos ?? '—'}</strong></div>
          </div>
          {Array.isArray(data.comodidades) && data.comodidades.length > 0 && <p className="ReportePage-sectionSubtitle">Amenities: {data.comodidades.join(' · ')}</p>}
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
    </RenderErrorBoundary>
  );
};
