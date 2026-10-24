import { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { ChartLine } from 'lucide-react';
import { type TasacionItem } from '../data/mock';
import { type Moneda } from '../lib/usuario-config';

type Props = {
  tasaciones: TasacionItem[];
  moneda: Moneda;
  formatearValor: (usd: number, alquiler?: boolean) => string;
};

type Punto = {
  tiempo: number;
  fechaCorta: string;
  valor: number;
  direccion: string;
  valorFormateado: string;
};

const fechaCorta = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
};

const TooltipContenido = ({ active, payload }: any) => {
  if (!active || !payload || payload.length === 0) return null;
  const punto: Punto = payload[0].payload;
  return (
    <div className="grafico__tooltip">
      <p className="grafico__tooltip-direccion">{punto.direccion}</p>
      <p className="grafico__tooltip-valor">{punto.valorFormateado}</p>
      <p className="grafico__tooltip-fecha">{punto.fechaCorta}</p>
    </div>
  );
};

export const GraficoValor = ({ tasaciones, moneda, formatearValor }: Props) => {
  const puntos = useMemo<Punto[]>(() => {
    return tasaciones
      .filter((t) => t.valorUsd != null && t.valorUsd > 0 && t.ultimaVez)
      .map((t) => {
        const d = new Date(t.ultimaVez as string);
        return {
          tiempo: d.getTime(),
          fechaCorta: fechaCorta(t.ultimaVez),
          valor: t.valorUsd as number,
          direccion: t.address,
          valorFormateado: formatearValor(t.valorUsd as number, t.esAlquiler),
        };
      })
      .sort((a, b) => a.tiempo - b.tiempo);
  }, [tasaciones, formatearValor]);

  if (puntos.length < 2) {
    return (
      <div className="grafico grafico--vacio">
        <ChartLine className="grafico__vacio-icono" aria-hidden />
        <p className="grafico__vacio-texto">
          Completá al menos 2 tasaciones para ver la evolución de tu historial.
        </p>
        <button
          type="button"
          className="grafico__vacio-cta"
          onClick={() => (window.location.href = '/tasacion')}
        >
          Realizar mi primera tasación
        </button>
      </div>
    );
  }

  return (
    <div className="grafico">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={puntos} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradienteCeleste" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#38BDF8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" stroke="#E2E8F0" vertical={false} />
          <XAxis
            dataKey="fechaCorta"
            tick={{ fill: '#64748B', fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: '#E2E8F0' }}
            minTickGap={24}
          />
          <YAxis
            tick={{ fill: '#64748B', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={72}
            tickFormatter={(v: number) => {
              if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
              if (v >= 1_000) return `${Math.round(v / 1000)}k`;
              return String(v);
            }}
          />
          <Tooltip content={<TooltipContenido />} cursor={{ stroke: '#0087C0', strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="valor"
            stroke="#0087C0"
            strokeWidth={3}
            fill="url(#gradienteCeleste)"
            dot={{ r: 5, fill: '#FFFFFF', stroke: '#0087C0', strokeWidth: 2 }}
            activeDot={{ r: 6, fill: '#0087C0', stroke: '#FFFFFF', strokeWidth: 2 }}
            animationDuration={1200}
          />
        </AreaChart>
      </ResponsiveContainer>
      <p className="grafico__moneda">{moneda}</p>
    </div>
  );
};
