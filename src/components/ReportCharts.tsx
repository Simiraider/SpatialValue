import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import '../styles/report-charts.css';

const cacData = [
  { name: 'Valor m²', valor: 2500 },
  { name: 'CAC zona', valor: 2100 },
  { name: 'Promedio barrio', valor: 2350 },
];

export const ValorM2CacChart = () => (
  <div className="ReportChart">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={cacData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 12, fill: '#64748b' }}
          tickFormatter={(v) => `$${v}`}
        />
        <Tooltip
          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
          formatter={(value) => [`$${Number(value ?? 0)} USD`, '']}
        />
        <Legend />
        <Bar dataKey="valor" fill="#2563eb" radius={[4, 4, 0, 0]} barSize={40} name="USD/m²" />
      </BarChart>
    </ResponsiveContainer>
  </div>
);



