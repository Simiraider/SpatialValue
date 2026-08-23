import {
  ScatterChart,
  Scatter,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  Label,
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

  return (
    <div className="ReportChart">
      <p className="ReportChart-subtitle">USD/m² vs. Superficie total</p>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="precioM2"
            type="number"
            name="USD/m²"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: '#64748b' }}
          >
            <Label value="USD/m²" position="bottom" offset={-2} style={{ fontSize: 11, fill: '#64748b' }} />
          </XAxis>
          <YAxis
            dataKey="superficie"
            type="number"
            name="m²"
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
                <div className="ReportChart-tooltip">
                  <p className="ReportChart-tooltipTitle">{d.nombre}</p>
                  <p>{d.precioM2.toLocaleString('es-AR')} USD/m² · {d.superficie} m²</p>
                </div>
              );
            }}
          />
          <ReferenceLine
            x={avgM2}
            stroke={COLORS.muted}
            strokeDasharray="4 4"
            label={{ value: `Promedio ${avgM2.toLocaleString('es-AR')}`, position: 'top', fontSize: 10, fill: COLORS.muted }}
          />
          <Scatter
            data={data.filter((d) => !d.esLaTasada)}
            fill={COLORS.muted}
            fillOpacity={0.7}
            name="Comparables"
          />
          <Scatter
            data={data.filter((d) => d.esLaTasada)}
            fill={COLORS.primary}
            stroke={COLORS.primary}
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

  return (
    <div className="ReportChart">
      <p className="ReportChart-subtitle">Comparativa directa de valores por m²</p>
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
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(v) => `$${v}`}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as TestigoBar;
              return (
                <div className="ReportChart-tooltip">
                  <p className="ReportChart-tooltipTitle">{d.nombre}</p>
                  <p>{d.precioM2.toLocaleString('es-AR')} USD/m²</p>
                </div>
              );
            }}
          />
          <Bar dataKey="precioM2" name="USD/m²" radius={[6, 6, 0, 0]}>
            {data.map((entry, idx) => (
              <Cell
                key={idx}
                fill={entry.esLaTasada ? COLORS.primary : COLORS.muted}
                fillOpacity={entry.esLaTasada ? 1 : 0.55}
              />
            ))}
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
    <div className="ReportChart">
      <p className="ReportChart-subtitle">Composición del valor estimado</p>
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
            label={({ name, percent }) =>
              `${name} ${(percent * 100).toFixed(0)}%`
            }
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
                <div className="ReportChart-tooltip">
                  <p className="ReportChart-tooltipTitle">{d.name}</p>
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
