import { useEffect, useMemo, useState } from 'react';
import {
  Search, ArrowDownUp, DollarSign, Info, ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { BARRIOS_CABA, VALORES_M2_POR_BARRIO } from '../lib/mercado';
import {
  parsePeriodo,
  serieDeAlquiler,
  serieReciente,
  ultimosPeriodos,
  valoresBarrio,
} from '../lib/historico';
import { PERIODO_ACTUAL, SERIE_ETIQUETA, SERIE_FUENTE } from '../data/historico-barrios';
import type { PuntoHistorial } from '../lib/historial';
import { TarjetaBarrio } from './TarjetaBarrio';
import { cargarDolar, dolarActual } from '../lib/dolar';
import { type Moneda } from '../lib/usuario-config';
import { getUser } from '../lib/session';
import { cn } from '../lib/utils';
import '../styles/indicadores.css';

type Criterio = 'venta' | 'alquiler';

type FilaBarrio = {
  nombre: string;
  clave: string;
  venta: number | null;
  alquiler: number | null;
  refVenta: number | null;
  refAlquiler: number | null;
  variacion: number | null;
  serie: PuntoHistorial[];
  porPeriodo: Record<string, number>;
};

const tituloBarrio = (clave: string): string =>
  clave
    .split(' ')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');

const formatoUsd = (v: number): string => `$${v.toLocaleString('es-AR')}`;

const formatoVariacion = (v: number): string =>
  `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}%`;

const TRAMOS: Record<Criterio, { limites: number[]; etiquetas: string[] }> = {
  venta: {
    limites: [1600, 2200, 2800],
    etiquetas: ['< 1.600', '1.600 – 2.200', '2.200 – 2.800', '≥ 2.800'],
  },
  alquiler: {
    limites: [6, 9, 12],
    etiquetas: ['< 6', '6 – 9', '9 – 12', '≥ 12'],
  },
};

const COLORES_TRAMO = ['#bae6fd', '#7dd3fc', '#38bdf8', '#0087c0'];

const Sparkline = ({ serie, color, alto = 40 }: { serie: PuntoHistorial[]; color: string; alto?: number }) => (
  <div className="indicadores__spark" style={{ height: alto }}>
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={serie} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
        <Line
          type="monotone"
          dataKey="valor"
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  </div>
);

const TooltipSimple = ({ active, payload, label, sufijo }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="indicadores__tooltip">
      <p className="indicadores__tooltip-titulo">{label ?? payload[0]?.name}</p>
      <p>
        {Number(payload[0].value).toLocaleString('es-AR')}
        {sufijo}
      </p>
    </div>
  );
};

export const IndicadoresMercado = () => {
  const [query, setQuery] = useState('');
  const [criterio, setCriterio] = useState<Criterio>('venta');
  const [ordenAsc, setOrdenAsc] = useState(false);
  const [dolar, setDolar] = useState(dolarActual());
  const [barrioExpandido, setBarrioExpandido] = useState<string | null>(null);

  useEffect(() => {
    cargarDolar().then((e) => setDolar(e.valor));
  }, []);

  const moneda: Moneda = getUser()?.moneda ?? 'USD';

  const base = useMemo<FilaBarrio[]>(() => {
    return BARRIOS_CABA.map((nombre) => {
      const clave = nombre
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      const ref = VALORES_M2_POR_BARRIO[clave];
      const { venta, alquiler, variacion, serie: serieVenta } = valoresBarrio(clave, {
        venta: ref?.venta ?? null,
        alquiler: ref?.alquiler ?? null,
      });
      const serieCriterio = criterio === 'venta' ? serieVenta : serieDeAlquiler(serieVenta);
      const puntos = serieReciente(serieCriterio, 16);
      const etiqueta = (p: string) => {
        const { anio, trim } = parsePeriodo(p);
        return `T${trim} ${String(anio).slice(2)}`;
      };
      const serie: PuntoHistorial[] = puntos.map((p, i) => {
        const anterior = i > 0 ? puntos[i - 1].v : p.v;
        return {
          mes: etiqueta(p.p),
          valor: p.v,
          variacion: anterior ? ((p.v - anterior) / anterior) * 100 : 0,
        };
      });
      const porPeriodo: Record<string, number> = {};
      for (const p of serieCriterio) porPeriodo[p.p] = p.v;
      return {
        nombre,
        clave,
        venta,
        alquiler,
        refVenta: ref?.venta ?? null,
        refAlquiler: ref?.alquiler ?? null,
        variacion,
        serie,
        porPeriodo,
      };
    });
  }, [criterio]);

  const seriePromedio = useMemo<PuntoHistorial[]>(() => {
    const periodos = ultimosPeriodos(PERIODO_ACTUAL, 16);
    const puntos: PuntoHistorial[] = [];
    for (const p of periodos) {
      const vals = base
        .map((b) => b.porPeriodo[p])
        .filter((v): v is number => typeof v === 'number');
      if (vals.length === 0) continue;
      const { anio, trim } = parsePeriodo(p);
      puntos.push({
        mes: `T${trim} ${String(anio).slice(2)}`,
        valor: Math.round(vals.reduce((a, v) => a + v, 0) / vals.length),
        variacion: 0,
      });
    }
    return puntos;
  }, [base]);

  const kpis = useMemo(() => {
    const conValor = base.filter((b) => (criterio === 'venta' ? b.venta : b.alquiler) != null);
    const val = (b: FilaBarrio) => (criterio === 'venta' ? b.venta! : b.alquiler!);
    const promedio =
      conValor.length > 0 ? Math.round(conValor.reduce((a, b) => a + val(b), 0) / conValor.length) : 0;
    const top = [...conValor].sort((a, b) => val(b) - val(a))[0] ?? null;
    const ultimo = seriePromedio[seriePromedio.length - 1]?.valor ?? 0;
    const primero = seriePromedio[0]?.valor ?? 1;
    const variacionProm = ((ultimo - primero) / primero) * 100;
    const mayorVariacion = [...conValor]
      .filter((b) => b.variacion != null)
      .sort((a, b) => (b.variacion ?? 0) - (a.variacion ?? 0))[0] ?? null;
    const top10 = [...conValor].sort((a, b) => val(b) - val(a)).slice(0, 10);
    return { promedio, top, variacionProm, mayorVariacion, top10 };
  }, [base, criterio, seriePromedio]);

  const tramos = useMemo(() => {
    const { limites, etiquetas } = TRAMOS[criterio];
    const conteo = [0, 0, 0, 0];
    for (const b of base) {
      const v = criterio === 'venta' ? b.venta : b.alquiler;
      if (v == null) continue;
      const idx = limites.findIndex((lim) => v < lim);
      conteo[idx === -1 ? 3 : idx]++;
    }
    return etiquetas.map((name, i) => ({ name, value: conteo[i] }));
  }, [base, criterio]);

  const filas = useMemo(() => {
    const q = query.trim().toLowerCase();
    const lista = base.filter((b) => !q || b.nombre.toLowerCase().includes(q));
    const campo = (b: FilaBarrio) => (criterio === 'venta' ? b.venta : b.alquiler);
    return lista.sort((a, b) => {
      const va = campo(a);
      const vb = campo(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return ordenAsc ? va - vb : vb - va;
    });
  }, [base, query, criterio, ordenAsc]);

  const sufijo = criterio === 'venta' ? ' USD/m²' : ' USD/m²/mes';

  const formatoValor = (v: number | null, tipo: Criterio): string => {
    if (v == null) return '—';
    if (moneda === 'ARS') {
      const s = tipo === 'venta' ? ' ARS/m²' : ' ARS/m²/mes';
      return `$${Math.round(v * dolar).toLocaleString('es-AR')}${s}`;
    }
    const s = tipo === 'venta' ? ' USD/m²' : ' USD/m²/mes';
    return `${formatoUsd(v)}${s}`;
  };

  const chipVariacion = (v: number) =>
    v > 0 ? 'indicadores__chip--sube' : v < 0 ? 'indicadores__chip--baja' : '';

  return (
    <div className="indicadores">
      <div className="indicadores__cabecera">
        <div>
          <h1 className="indicadores__titulo">Indicadores de mercado</h1>
          <p className="indicadores__descripcion">
            Valor del m² por barrio con la serie oficial del INDEC CABA (2006 → 2026, trimestral) y
            referencia de tipo de cambio.
          </p>
        </div>
        <div className="indicadores__dolar">
          <DollarSign className="indicadores__dolar-icono" aria-hidden />
          <div>
            <p className="indicadores__dolar-titulo">Tipo de cambio aplicado</p>
            <p className="indicadores__dolar-valor">
              1 USD = ${dolar.toLocaleString('es-AR')} ARS
            </p>
          </div>
        </div>
      </div>
      <section className="indicadores__kpis" aria-label="Resumen del indicador">
        <article className="indicadores__kpi indicadores__kpi--principal">
          <header className="indicadores__kpi-cabecera">
            <span className="indicadores__kpi-titulo">
              {criterio === 'venta' ? 'Valor promedio de venta' : 'Valor promedio de alquiler'}
            </span>
            <span className={cn('indicadores__chip', chipVariacion(kpis.variacionProm))}>
              {kpis.variacionProm > 0 ? (
                <ArrowUpRight aria-hidden />
              ) : kpis.variacionProm < 0 ? (
                <ArrowDownRight aria-hidden />
              ) : (
                <Minus aria-hidden />
              )}
              {formatoVariacion(kpis.variacionProm)} · 4 años
            </span>
          </header>
          <p className="indicadores__kpi-valor">
            {formatoUsd(kpis.promedio)}
            <small>{sufijo}</small>
          </p>
          <Sparkline serie={seriePromedio} color="#0087c0" alto={56} />
          <p className="indicadores__kpi-pie">Índice promedio de {BARRIOS_CABA.length} barrios de CABA</p>
        </article>

        <article className="indicadores__kpi">
          <header className="indicadores__kpi-cabecera">
            <span className="indicadores__kpi-titulo">Barrio más caro</span>
          </header>
          <p className="indicadores__kpi-valor indicadores__kpi-valor--chico">
            {kpis.top ? tituloBarrio(kpis.top.nombre.toLowerCase()) : '—'}
          </p>
          <p className="indicadores__kpi-secundario">
            {kpis.top
              ? formatoValor(criterio === 'venta' ? kpis.top.venta : kpis.top.alquiler, criterio)
              : 'Sin datos'}
          </p>
          {kpis.top && <Sparkline serie={kpis.top.serie} color="#005477" alto={48} />}
        </article>

        <article className="indicadores__kpi">
          <header className="indicadores__kpi-cabecera">
            <span className="indicadores__kpi-titulo">Mayor variación (12 m)</span>
          </header>
          <p className="indicadores__kpi-valor indicadores__kpi-valor--chico">
            {kpis.mayorVariacion ? tituloBarrio(kpis.mayorVariacion.nombre.toLowerCase()) : '—'}
          </p>
          <span
            className={cn(
              'indicadores__chip indicadores__chip--grande',
              chipVariacion(kpis.mayorVariacion?.variacion ?? 0)
            )}
          >
            {(kpis.mayorVariacion?.variacion ?? 0) > 0 ? (
              <ArrowUpRight aria-hidden />
            ) : (
              <ArrowDownRight aria-hidden />
            )}
            {kpis.mayorVariacion ? formatoVariacion(kpis.mayorVariacion.variacion ?? 0) : '—'}
          </span>
          {kpis.mayorVariacion && <Sparkline serie={kpis.mayorVariacion.serie} color="#16a34a" alto={48} />}
        </article>

        <article className="indicadores__kpi">
          <header className="indicadores__kpi-cabecera">
            <span className="indicadores__kpi-titulo">Tipo de cambio</span>
          </header>
          <p className="indicadores__kpi-valor indicadores__kpi-valor--chico">
            ${dolar.toLocaleString('es-AR')}
            <small> ARS</small>
          </p>
          <p className="indicadores__kpi-secundario">Referencia oficial · base de todas las conversiones</p>
          <p className="indicadores__kpi-pie">
            Promedio {formatoValor(kpis.promedio, criterio)}
            {moneda === 'ARS' ? '' : ' · en pesos: '}
            {moneda === 'ARS'
              ? ''
              : `$${Math.round(kpis.promedio * dolar).toLocaleString('es-AR')} ARS/m²`}
          </p>
        </article>
      </section>

      <section className="indicadores__paneles">
        <article className="indicadores__panel">
          <header className="indicadores__panel-cabecera">
            <div>
              <h2 className="indicadores__panel-titulo">Evolución del indicador</h2>
              <p className="indicadores__panel-sub">
                {criterio === 'venta' ? 'USD/m² de venta' : 'USD/m²/mes de alquiler'} · promedio CABA ·
                últimos 4 años (trimestral)
              </p>
            </div>
            <span className={cn('indicadores__chip indicadores__chip--grande', chipVariacion(kpis.variacionProm))}>
              {formatoVariacion(kpis.variacionProm)}
            </span>
          </header>
          <div className="indicadores__panel-grafico">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={seriePromedio} margin={{ top: 10, right: 12, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="gradIndic" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0087c0" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0087c0" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={54}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  domain={['auto', 'auto']}
                />
                <Tooltip content={<TooltipSimple sufijo={sufijo} />} />
                <Area
                  type="monotone"
                  dataKey="valor"
                  stroke="#0087c0"
                  strokeWidth={2.5}
                  fill="url(#gradIndic)"
                  dot={false}
                  activeDot={{ r: 5, fill: '#0087c0', stroke: '#fff', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="indicadores__panel">
          <header className="indicadores__panel-cabecera">
            <div>
              <h2 className="indicadores__panel-titulo">Distribución por tramos</h2>
              <p className="indicadores__panel-sub">Barrios por nivel de precio · {sufijo.trim()}</p>
            </div>
          </header>
          <div className="indicadores__panel-grafico indicadores__panel-grafico--donut">
            <div className="indicadores__donut-zona">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={tramos}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="52%"
                  outerRadius="82%"
                  paddingAngle={2}
                  isAnimationActive={false}
                >
                  {tramos.map((_, i) => (
                    <Cell key={i} fill={COLORES_TRAMO[i % COLORES_TRAMO.length]} />
                  ))}
                </Pie>
                <Tooltip content={<TooltipSimple sufijo=" barrios" />} />
              </PieChart>
            </ResponsiveContainer>
            </div>
            <ul className="indicadores__leyenda">
              {tramos.map((t, i) => (
                <li key={t.name}>
                  <span className="indicadores__leyenda-punto" style={{ background: COLORES_TRAMO[i] }} />
                  <span className="indicadores__leyenda-etiqueta">{t.name}</span>
                  <strong>{t.value}</strong>
                </li>
              ))}
            </ul>
          </div>
        </article>
      </section>

      <section className="indicadores__panel indicadores__panel--ancho" aria-label="Top 10 de barrios">
        <header className="indicadores__panel-cabecera">
          <div>
            <h2 className="indicadores__panel-titulo">Top 10 de barrios</h2>
            <p className="indicadores__panel-sub">
              {criterio === 'venta' ? 'Mayor valor de venta por m²' : 'Mayor valor de alquiler por m²'} ·{' '}
              {sufijo.trim()}
            </p>
          </div>
        </header>
        <div className="indicadores__panel-grafico indicadores__panel-grafico--top">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={kpis.top10.map((b) => ({
                nombre: tituloBarrio(b.nombre.toLowerCase()),
                valor: criterio === 'venta' ? b.venta : b.alquiler,
              }))}
              layout="vertical"
              margin={{ top: 4, right: 24, bottom: 0, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
              <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis
                type="category"
                dataKey="nombre"
                axisLine={false}
                tickLine={false}
                width={118}
                tick={{ fontSize: 11, fill: '#475569' }}
              />
              <Tooltip cursor={{ fill: 'rgba(0, 135, 192, 0.06)' }} content={<TooltipSimple sufijo={sufijo} />} />
              <Bar dataKey="valor" radius={[0, 6, 6, 0]} maxBarSize={22} isAnimationActive={false}>
                {kpis.top10.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? '#0087c0' : '#7dd3fc'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="indicadores__controles">
        <div className="indicadores__buscador">
          <Search className="indicadores__buscador-icono" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar barrio..."
            className="indicadores__buscador-entrada"
            aria-label="Buscar barrio"
          />
        </div>

        <div className="indicadores__criterio" role="radiogroup" aria-label="Criterio del valor del m²">
          <button
            type="button"
            role="radio"
            aria-checked={criterio === 'venta'}
            className={cn('indicadores__criterio-opcion', criterio === 'venta' && 'indicadores__criterio-opcion--activa')}
            onClick={() => setCriterio('venta')}
          >
            Venta (USD/m²)
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={criterio === 'alquiler'}
            className={cn('indicadores__criterio-opcion', criterio === 'alquiler' && 'indicadores__criterio-opcion--activa')}
            onClick={() => setCriterio('alquiler')}
          >
            Alquiler (USD/m²/mes)
          </button>
        </div>

        <button
          type="button"
          className="indicadores__boton-orden"
          onClick={() => setOrdenAsc((v) => !v)}
          aria-label={ordenAsc ? 'Ordenar de mayor a menor' : 'Ordenar de menor a mayor'}
          title={ordenAsc ? 'Ordenar de mayor a menor' : 'Ordenar de menor a mayor'}
        >
          <ArrowDownUp className="indicadores__boton-orden-icono" aria-hidden />
          {ordenAsc ? 'Menor a mayor' : 'Mayor a menor'}
        </button>
      </div>

      {filas.length === 0 ? (
        <div className="indicadores__vacio">
          <Search className="indicadores__vacio-icono" aria-hidden />
          <p>No encontramos barrios para tu búsqueda.</p>
        </div>
      ) : (
        <div className="indicadores__grid">
          {filas.map((b) => (
            <TarjetaBarrio
              key={b.nombre}
              nombre={tituloBarrio(b.nombre.toLowerCase())}
              clave={b.clave}
              criterio={criterio}
              ventaReferencia={b.refVenta}
              alquilerReferencia={b.refAlquiler}
              formatear={formatoValor}
              expandida={barrioExpandido === b.clave}
              onAlternar={() =>
                setBarrioExpandido((actual) => (actual === b.clave ? null : b.clave))
              }
            />
          ))}
        </div>
      )}

      {filas.length > 0 && (
        <p className="indicadores__cargando-nota">
          <Info className="indicadores__nota-icono" aria-hidden />
          Serie oficial de venta por barrio: {SERIE_FUENTE}, publicada por trimestres hasta{' '}
          {PERIODO_ACTUAL.replace('-T', ' ')}° trimestre ({SERIE_ETIQUETA}). El alquiler se deriva del
          valor de venta con un rendimiento del 4,5% anual. Los barrios sin dato oficial usan el valor de
          referencia del scraper.
        </p>
      )}
    </div>
  );
};
