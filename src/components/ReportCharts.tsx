import { useMemo } from 'react';
import { serieHistorialM2 as construirSerie, type PuntoHistorial } from '../lib/historial';
import {
  ScatterChart,
  Scatter,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  Label,
  LabelList,
} from 'recharts';
import '../styles/report-charts.css';

const COLORS = {
  primary: '#0891b2',
  secondary: '#06b6d4',
  accent: '#2563eb',
  highlight: '#f59e0b',
  muted: '#94a3b8',
  positive: '#10b981',
  negative: '#ef4444',
  bg: ['#0891b2', '#2563eb', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899'],
};

type ComparablePoint = {
  nombre: string;
  precioM2: number;
  superficie: number;
  esLaTasada?: boolean;
};

type DispercionChartProps = {
  valorM2Propiedad: number;
  supTotal: number;
  comparables: ComparablePoint[];
  direccion?: string;
};

export const DispercionChart = ({ valorM2Propiedad, supTotal, comparables, direccion }: DispercionChartProps) => {
  const data: ComparablePoint[] = [
    ...comparables.map((c) => ({ ...c, esLaTasada: false })),
    { nombre: direccion || 'Inmueble tasado', precioM2: valorM2Propiedad, superficie: supTotal, esLaTasada: true },
  ];

  const avgM2 = data.length > 0
    ? Math.round(data.reduce((a, d) => a + d.precioM2, 0) / data.length)
    : valorM2Propiedad;

  const avgSup = data.length > 0
    ? Math.round(data.reduce((a, d) => a + d.superficie, 0) / data.length)
    : supTotal;

  const m2Vals = data.map((d) => d.precioM2);
  const supVals = data.map((d) => d.superficie);
  const xMin = Math.floor(Math.min(...m2Vals) * 0.96);
  const xMax = Math.ceil(Math.max(...m2Vals) * 1.04);
  const yMin = Math.max(0, Math.floor(Math.min(...supVals) - 8));
  const yMax = Math.ceil(Math.max(...supVals) + 8);

  return (
    <div className="reporte-grafico">
      <p className="reporte-grafico__subtitulo">
        USD/m² vs. Superficie total · promedio {avgM2.toLocaleString('es-AR')} USD/m² · superficie media {avgSup.toLocaleString('es-AR')} m²
      </p>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="precioM2"
            type="number"
            name="USD/m²"
            domain={[xMin, xMax]}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: '#64748b' }}
          >
          </XAxis>
          <YAxis
            dataKey="superficie"
            type="number"
            name="m²"
            domain={[yMin, yMax]}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: '#64748b' }}
          >
            <Label value="m²" angle={-90} position="insideLeft" offset={10} style={{ fontSize: 11, fill: '#64748b' }} />
          </YAxis>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as ComparablePoint;
              return (
                <div className="reporte-grafico__tooltip">
                  <p className="reporte-grafico__tooltip-titulo">{d.nombre}</p>
                  <p>{d.precioM2.toLocaleString('es-AR')} USD/m² · {d.superficie} m²</p>
                  <p className="reporte-grafico__tooltip-extra">
                    {d.esLaTasada ? 'Propiedad tasada' : `Valor aprox. $${Math.round((d.precioM2 * d.superficie) / 1000)}k USD`}
                  </p>
                </div>
              );
            }}
          />
          <ReferenceLine
            x={avgM2}
            stroke={COLORS.muted}
            strokeDasharray="4 4"
          />
          <ReferenceLine
            y={avgSup}
            stroke="#38bdf8"
            strokeDasharray="4 4"
          />
          <ZAxis dataKey="superficie" range={[50, 260]} name="Superficie" />
          <Scatter
            data={data.filter((d) => !d.esLaTasada)}
            fill="#38bdf8"
            fillOpacity={0.65}
            name="Comparables"
          />
          <Scatter
            data={data.filter((d) => d.esLaTasada)}
            fill="#005477"
            stroke="#0087c0"
            strokeWidth={2}
            name="Propiedad tasada"
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={(value) => <span style={{ color: '#475569' }}>{value}</span>}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
};

type TestigoBar = {
  nombre: string;
  precioM2: number;
  esLaTasada?: boolean;
};

type ComparativaBarChartProps = {
  valorM2Propiedad: number;
  direccion?: string;
  testigos: TestigoBar[];
};

export const ComparativaBarChart = ({ valorM2Propiedad, direccion, testigos }: ComparativaBarChartProps) => {
  const data: TestigoBar[] = [
    { nombre: 'Tasada', precioM2: valorM2Propiedad, esLaTasada: true },
    ...testigos.map((t) => ({ ...t, esLaTasada: false })),
  ];

  const promedio = Math.round(data.reduce((a, d) => a + d.precioM2, 0) / Math.max(data.length, 1));
  const maxM2 = Math.max(...data.map((d) => d.precioM2), 1);

  return (
    <div className="reporte-grafico">
      <p className="reporte-grafico__subtitulo">Comparativa directa de valores por m²</p>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 20 }} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis
            dataKey="nombre"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: '#64748b' }}
            angle={-15}
            textAnchor="end"
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            domain={[0, Math.ceil(maxM2 * 1.18)]}
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(v) => `$${v}`}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as TestigoBar;
              return (
                <div className="reporte-grafico__tooltip">
                  <p className="reporte-grafico__tooltip-titulo">{d.nombre}</p>
                  <p>{d.precioM2.toLocaleString('es-AR')} USD/m²</p>
                </div>
              );
            }}
          />
          <ReferenceLine
            y={promedio}
            stroke="#10b981"
            strokeDasharray="5 4"
            label={{ value: `Promedio ${promedio.toLocaleString('es-AR')}`, position: 'insideTopRight', fontSize: 10, fill: '#059669' }}
          />
          <Bar dataKey="precioM2" name="USD/m²" radius={[6, 6, 0, 0]} maxBarSize={72}>
            {data.map((entry, idx) => (
              <Cell
                key={idx}
                fill={entry.esLaTasada ? '#0087c0' : '#7dd3fc'}
                fillOpacity={entry.esLaTasada ? 1 : 0.75}
              />
            ))}
            <LabelList
              dataKey="precioM2"
              position="top"
              formatter={(v) => Number(v ?? 0).toLocaleString('es-AR')}
              style={{ fontSize: 11, fontWeight: 700, fill: '#0f172a' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

type SectorData = { name: string; value: number };

type ComposicionPieChartProps = {
  valorUsd: number;
  supCub: number;
  barrio?: string;
};

export const ComposicionPieChart = ({ valorUsd, supCub, barrio }: ComposicionPieChartProps) => {
  const precioM2Terreno = barrio ? 2400 : 2000;
  const valorSuelo = Math.round(supCub * precioM2Terreno * 0.35);
  const valorEdificacion = Math.round(valorUsd - valorSuelo);
  const valorAmenities = Math.round(valorUsd * 0.08);
  const valorUbicacion = Math.round(valorUsd - valorSuelo - (valorEdificacion - valorAmenities));

  const data: SectorData[] = [
    { name: 'Valor del suelo', value: Math.max(0, valorSuelo) },
    { name: 'Edificación', value: Math.max(0, valorEdificacion - valorAmenities) },
    { name: 'Amenities yExtras', value: Math.max(0, valorAmenities) },
    { name: 'Ubicación y Entorno', value: Math.max(0, valorUbicacion) },
  ].filter((d) => d.value > 0);

  const total = data.reduce((a, d) => a + d.value, 0);

  return (
    <div className="reporte-grafico">
      <p className="reporte-grafico__subtitulo">Composición del valor estimado</p>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius="40%"
            outerRadius="72%"
            paddingAngle={3}
            dataKey="value"
            nameKey="name"
            label={({ cx, cy, midAngle, outerRadius, name, percent }) => {
              const R = (outerRadius ?? 0) + 14;
              const RAD = Math.PI / 180;
              const ang = (midAngle ?? 0) * RAD;
              const x = (cx ?? 0) + R * Math.cos(-ang);
              const y = (cy ?? 0) + R * Math.sin(-ang);
              const anchor = x > (cx ?? 0) ? 'start' : 'end';
              return (
                <text x={x} y={y} fill="#1e293b" fontSize={12} fontWeight={600} textAnchor={anchor} dominantBaseline="central">
                  {`${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                </text>
              );
            }}
            labelLine={{ stroke: '#94a3b8', strokeWidth: 1 }}
          >
            {data.map((_, idx) => (
              <Cell key={idx} fill={COLORS.bg[idx % COLORS.bg.length]} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0];
              const val = Number(d.value) || 0;
              const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
              return (
                <div className="reporte-grafico__tooltip">
                  <p className="reporte-grafico__tooltip-titulo">{d.name}</p>
                  <p>{val.toLocaleString('es-AR')} USD ({pct}%)</p>
                </div>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

/* ============================================================
   Historial de precios del barrio (12 meses)
   La serie vive en src/lib/historial.ts y se comparte con Indicadores.
   ============================================================ */

export const HistorialBarrioChart = ({ barrio, valorM2 }: { barrio?: string; valorM2: number }) => {
  const datos = useMemo(() => construirSerie(barrio, valorM2), [barrio, valorM2]);
  const min = Math.min(...datos.map((d) => d.valor));
  const max = Math.max(...datos.map((d) => d.valor));
  const primero = datos[0]?.valor || 1;
  const ultimo = datos[datos.length - 1]?.valor || primero;
  const acumulada = ((ultimo - primero) / primero) * 100;

  return (
    <div className="reporte-grafico">
      <p className="reporte-grafico__subtitulo">
        USD/m² · {barrio || 'CABA'} · últimos 12 meses ({acumulada >= 0 ? '+' : ''}{acumulada.toFixed(1)}%)
      </p>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={datos} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gradHistorialM2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0087c0" stopOpacity={0.34} />
              <stop offset="100%" stopColor="#0087c0" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
          <YAxis
            domain={[Math.floor(min * 0.985), Math.ceil(max * 1.02)]}
            axisLine={false}
            tickLine={false}
            width={52}
            tick={{ fontSize: 11, fill: '#64748b' }}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as PuntoHistorial;
              return (
                <div className="reporte-grafico__tooltip">
                  <p className="reporte-grafico__tooltip-titulo">{label}</p>
                  <p>{d.valor.toLocaleString('es-AR')} USD/m²</p>
                  <p className="reporte-grafico__tooltip-extra">
                    {d.variacion >= 0 ? '+' : ''}{d.variacion.toFixed(1)}% vs. mes anterior
                  </p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="valor"
            stroke="#0087c0"
            strokeWidth={2.5}
            fill="url(#gradHistorialM2)"
            dot={false}
            activeDot={{ r: 5, fill: '#0087c0', stroke: '#ffffff', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export const VariacionMensualChart = ({ barrio, valorM2 }: { barrio?: string; valorM2: number }) => {
  const serie = useMemo(() => construirSerie(barrio, valorM2), [barrio, valorM2]);
  const datos = serie.map((p) => ({ mes: p.mes, variacion: Number(p.variacion.toFixed(2)) }));
  const conDatos = datos.slice(1);
  const maxAbs = Math.max(...conDatos.map((d) => Math.abs(d.variacion)), 1);
  const promedio = conDatos.length > 0
    ? conDatos.reduce((a, d) => a + d.variacion, 0) / conDatos.length
    : 0;

  return (
    <div className="reporte-grafico">
      <p className="reporte-grafico__subtitulo">
        Variación mensual · promedio {promedio >= 0 ? '+' : ''}{promedio.toFixed(2)}% por mes
      </p>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={conDatos} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
          <YAxis
            domain={[Math.floor(maxAbs * -1.3), Math.ceil(maxAbs * 1.3)]}
            axisLine={false}
            tickLine={false}
            width={46}
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(v) => `${v}%`}
          />
          <ReferenceLine y={0} stroke="#94a3b8" />
          <Tooltip
            cursor={{ fill: 'rgba(0, 135, 192, 0.06)' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const valor = Number(payload[0].value) || 0;
              return (
                <div className="reporte-grafico__tooltip">
                  <p className="reporte-grafico__tooltip-titulo">{label}</p>
                  <p className={valor >= 0 ? 'reporte-grafico__valor reporte-grafico__valor--sube' : 'reporte-grafico__valor reporte-grafico__valor--baja'}>
                    {valor >= 0 ? '+' : ''}{valor.toFixed(2)}% respecto al mes anterior
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="variacion" radius={[4, 4, 0, 0]} maxBarSize={38}>
            {conDatos.map((d, idx) => (
              <Cell key={idx} fill={d.variacion >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
