import React, { useEffect, useState, Component, type ReactNode } from 'react';
import { DispercionChart, ComparativaBarChart, ComposicionPieChart } from './ReportCharts';
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
  if (raw.id_publicacion != null) return mapearDesdeDB(raw);
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
  const [comparables, setComparables] = useState<any[]>([]);

  const cargar = async () => {
    setData(null);
    setError(null);
    try {
      const params = new URLSearchParams(window.location.search);
      const urlId = params.get('id');

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

  useEffect(() => {
    if (!data) return;
    const usuarioId = getUsuarioId();
    if (!usuarioId) return;

    const supTotal = Number(data.superficieCubierta) || 0;
    const qs = new URLSearchParams({
      id: String(data.id || ''),
      usuario_id: usuarioId,
      barrio: data.barrio || '',
      superficie: String(supTotal),
      tipo_operacion: data.tipo_operacion || 'venta',
    });

    apiFetch(`/Apis/ObtenerComparables?${qs.toString()}`, {}, 6000)
      .then(({ ok, data: comps }) => {
        if (ok && Array.isArray(comps)) {
          setComparables(comps);
        }
      })
      .catch(() => {});
  }, [data]);

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

  const scatterComps = comparables.map((c: any) => {
    const precioIA = Number(c.precio_estimado_ia) || 0;
    const supC = Number(c.superficie_cubierta) || 0;
    const precioM2 = supC > 0 && precioIA > 0 ? Math.round(precioIA / supC) : 0;
    return {
      nombre: c.direccion || c.titulo || 'Comparable',
      precioM2,
      superficie: Number(c.superficie_total) || supC,
    };
  }).filter((c: any) => c.precioM2 > 0);

  const barComps = scatterComps.map((c: any) => ({
    nombre: c.nombre.length > 16 ? c.nombre.substring(0, 14) + '…' : c.nombre,
    precioM2: c.precioM2,
  }));

  const testigosParaGrafico = barComps.length > 0 ? barComps : [
    { nombre: 'Testigo 1', precioM2: Math.round(v.valorM2 * 0.88) },
    { nombre: 'Testigo 2', precioM2: Math.round(v.valorM2 * 1.06) },
    { nombre: 'Testigo 3', precioM2: Math.round(v.valorM2 * 0.95) },
    { nombre: 'Testigo 4', precioM2: Math.round(v.valorM2 * 1.12) },
  ];

  const scatterParaGrafico = scatterComps.length > 0 ? scatterComps : testigosParaGrafico.map((t: any) => ({
    nombre: t.nombre,
    precioM2: t.precioM2,
    superficie: Math.round(v.supCub * (0.85 + Math.random() * 0.3)),
  }));

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

        {alquiler && (
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
        )}

        <section className="ReportePage-section">
          <h2 className="ReportePage-sectionTitle">Análisis de dispersión de mercado</h2>
          <p className="ReportePage-sectionSubtitle">
            Ubicación estratégica de la propiedad en relación con las del mismo barrio y zona.
            El eje X representa el valor por m² y el eje Y la superficie total.
          </p>
          <DispercionChart
            valorM2Propiedad={v.valorM2}
            supTotal={v.supTotal}
            comparables={scatterParaGrafico}
            direccion={data.direccion}
          />
        </section>

        <section className="ReportePage-section">
          <h2 className="ReportePage-sectionTitle">Comparativa directa de valores</h2>
          <p className="ReportePage-sectionSubtitle">
            Comparación del valor por m² de la propiedad tasada con propiedades similares de la zona.
          </p>
          <ComparativaBarChart
            valorM2Propiedad={v.valorM2}
            direccion={data.direccion}
            testigos={testigosParaGrafico}
          />
        </section>

        {!alquiler && (
          <section className="ReportePage-section">
            <h2 className="ReportePage-sectionTitle">Composición del valor</h2>
            <p className="ReportePage-sectionSubtitle">
              Desglose estimado del valor total según componentes: suelo, edificación, amenities y ubicación.
            </p>
            <ComposicionPieChart valorUsd={v.valorUsd} supCub={v.supCub} barrio={data.barrio} />
          </section>
        )}

        <section className="ReportePage-section">
          <h2 className="ReportePage-sectionTitle">
            {alquiler ? 'Propiedades de alquiler similares' : 'Propiedades comparables'}
          </h2>
          {comparables.length > 0 ? (
            <>
              <p className="ReportePage-sectionSubtitle">
                Se encontraron {comparables.length} propiedad{comparables.length > 1 ? 'es' : ''} {comparables.length > 1 ? 'similares' : 'similar'} en tus tasaciones del mismo barrio.
              </p>
              <div className="ReportePage-comparables">
                {comparables.map((c: any) => {
                  const precioIA = Number(c.precio_estimado_ia) || Number(c.precio) || 0;
                  const supC = Number(c.superficie_cubierta) || 0;
                  return (
                    <a
                      key={c.id_publicacion}
                      href={`/reporte?id=${c.id_publicacion}`}
                      className="ReportePage-comparableCard"
                    >
                      <div className="ReportePage-comparableHeader">
                        <span className="ReportePage-comparableBadge">{c.tipo_propiedad || 'Inmueble'}</span>
                        <span className="ReportePage-comparableM2">
                          {supC > 0 ? `${fmt(supC)} m²` : '—'}
                        </span>
                      </div>
                      <p className="ReportePage-comparableDir">{c.direccion || c.titulo || 'Sin dirección'}</p>
                      <div className="ReportePage-comparableFooter">
                        <span className="ReportePage-comparablePrice">
                          {precioIA > 0 ? `$${fmt(precioIA)} USD` : 'Sin precio'}
                        </span>
                        {supC > 0 && precioIA > 0 && (
                          <span className="ReportePage-comparableM2Price">
                            {fmt(Math.round(precioIA / supC))} USD/m²
                          </span>
                        )}
                      </div>
                    </a>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="ReportePage-noComparables">
              <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔍</p>
              <p style={{ fontWeight: 500, color: '#475569' }}>
                No tienes propiedades comparables en este barrio
              </p>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                Para ver comparables, necesitás tener otras tasaciones en el mismo barrio ({data.barrio || 'desconocido'}) con superficie similar.
              </p>
            </div>
          )}
        </section>

        <section className="ReportePage-section">
          <h2 className="ReportePage-sectionTitle">
            Ubicación de la propiedad
          </h2>
          <MapaReporte
            lat={data.latitud}
            lng={data.longitud}
            direccion={data.direccion}
          />
        </section>

        <ReportActions />
      </main>
    </div>
    </RenderErrorBoundary>
  );
};
