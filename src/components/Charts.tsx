import React from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend
} from 'recharts';

const dataArea = [
  { name: 'Ene', valor: 120000 },
  { name: 'Feb', valor: 122000 },
  { name: 'Mar', valor: 121500 },
  { name: 'Abr', valor: 125000 },
  { name: 'May', valor: 128000 },
  { name: 'Jun', valor: 132000 },
  { name: 'Jul', valor: 135000 },
];

const dataBar = [
  { name: 'Palermo', promedio: 3200 },
  { name: 'Belgrano', promedio: 2900 },
  { name: 'Recoleta', promedio: 3100 },
  { name: 'Caballito', promedio: 2200 },
  { name: 'Almagro', promedio: 1900 },
];

export const PriceHistoryChart = () => {
  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={dataArea} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorValor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
          <YAxis 
            axisLine={false} 
            tickLine={false} 
            tick={{ fontSize: 12, fill: '#64748b' }} 
            tickFormatter={(value) => `$${value/1000}k`}
          />
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <Tooltip 
            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            formatter={(value: any) => [`$${value.toLocaleString()}`, 'Valor Histórico']}
          />
          <Area type="monotone" dataKey="valor" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorValor)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export const MarketComparisonChart = () => {
  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dataBar} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} layout="vertical">
          <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
          <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} width={80} />
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
          <Tooltip 
            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            cursor={{ fill: '#f1f5f9' }}
            formatter={(value: any) => [`$${value}/m²`, 'Precio Promedio']}
          />
          <Bar dataKey="promedio" fill="#818cf8" radius={[0, 4, 4, 0]} barSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
