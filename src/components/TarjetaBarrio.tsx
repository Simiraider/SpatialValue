import { useMemo, useState } from 'react';
import {
  ArrowDownRight, ArrowUpRight, Maximize2, Minimize2, Minus, TrendingUp,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  PERIODO_ACTUAL,
  SERIE_ETIQUETA,
  SERIE_FUENTE,
  type PuntoSerie,
} from '../data/historico-barrios';
import {
  dominioAjustado,
  parsePeriodo,
  resumenSerie,
  serieDeAlquiler,
  seriePorRango,
  ticksPeriodoAnual,
  valoresBarrio,
  variacionesTrimestrales,
  type RangoTiempo,
} from '../lib/historico';
import { cn } from '../lib/utils';
import '../styles/indicadores.css';

type Criterio = 'venta' | 'alquiler';

export interface TarjetaBarrioProps {
  nombre: string;
  clave: string;
  criterio: Criterio;
  ventaReferencia: number | null;
  alquilerReferencia: number | null;
  formatear: (v: number | null, tipo: Criterio) => string;
  expandida: boolean;
  onAlternar: () => void;
}

const fmtPct = (v: number): string => `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}%`;

const TooltipPeriodo = ({ active, payload, sufijo }: any) => {
  if (!active || !payload?.length) return null;
  const punto = payload[0].payload as PuntoSerie & { etiqueta?: string };
  const pStr = punto.p || '';
  const [anio, trim] = pStr.includes('-T') ? pStr.split('-T') : ['', ''];
  const textoPeriodo = anio && trim ? `T${trim} ${anio}` : (punto.etiqueta ?? punto.p);
  const valor = Number(payload[0].value);

  return (
    <div className="indicadores__tooltip">
      <p className="indicadores__tooltip-titulo">{textoPeriodo}</p>
      <p className="indicadores__tooltip-valor">
        {valor.toLocaleString('es-AR')}
        {sufijo}
      </p>
    </div>
  );
};

const TooltipVariacion = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const punto = payload[0].payload;
  const pct = Number(punto.pct);
  const sube = pct >= 0;

  return (
    <div className="indicadores__tooltip">
      <p className="indicadores__tooltip-titulo">{punto.trimestreLargo || punto.periodo}</p>
      <p className={cn('indicadores__tooltip-valor', sube ? 'indicadores__tooltip--sube' : 'indicadores__tooltip--baja')}>
        {fmtPct(pct)} vs trimestre anterior
      </p>
      {punto.valor && (
        <p className="indicadores__tooltip-sub">
          Valor: ${Math.round(punto.valor).toLocaleString('es-AR')} USD/m²
        </p>
      )}
    </div>
  );
};

export const TarjetaBarrio = ({
  nombre,
  clave,
  criterio,
  ventaReferencia,
  alquilerReferencia,
  formatear,
  expandida,
  onAlternar,
}: TarjetaBarrioProps) => {
  const [rangoMini, setRangoMini] = useState<RangoTiempo>('4a');
  const [limiteBarras, setLimiteBarras] = useState<number>(16);

  const { serie: serieVenta, venta, alquiler, variacion } = valoresBarrio(clave, {
    venta: ventaReferencia,
    alquiler: alquilerReferencia,
  });

  const serie = useMemo(
    () => (criterio === 'venta' ? serieVenta : serieDeAlquiler(serieVenta)),
    [serieVenta, criterio]
  );

  const serieMini = useMemo(() => seriePorRango(serie, rangoMini), [serie, rangoMini]);

  const variacionesTrim = useMemo(
    () => variacionesTrimestrales(serie, limiteBarras),
    [serie, limiteBarras]
  );

  const resumen = useMemo(() => resumenSerie(serie), [serie]);

  const varMini = useMemo(() => {
    if (serieMini.length < 2) return null;
    const ini = serieMini[0].v;
    const fin = serieMini[serieMini.length - 1].v;
    if (!ini) return null;
    return ((fin - ini) / ini) * 100;
  }, [serieMini]);

  const subioMini = (varMini ?? variacion ?? 0) > 0;
  const bajoMini = (varMini ?? variacion ?? 0) < 0;
  const colorMini = subioMini ? '#16a34a' : bajoMini ? '#dc2626' : '#64748b';

  const subio12m = (variacion ?? 0) > 0;
  const bajo12m = (variacion ?? 0) < 0;
  const TendenciaIcono = variacion == null ? Minus : subio12m ? ArrowUpRight : bajo12m ? ArrowDownRight : Minus;

  const dominioMini = dominioAjustado(serieMini.map((p) => p.v));
  const dominioGrande = dominioAjustado(serie.map((p) => p.v));
  const ticksAllTime = useMemo(() => ticksPeriodoAnual(serie, 8), [serie]);

  const sufijo = criterio === 'venta' ? ' USD/m²' : ' USD/m²/mes';

  const periodoTexto = useMemo(() => {
    if (!serieMini.length) return '';
    const pIni = parsePeriodo(serieMini[0].p);
    const pFin = parsePeriodo(serieMini[serieMini.length - 1].p);
    return `${pIni.anio} → ${pFin.anio} · ${serieMini.length} trimestres`;
  }, [serieMini]);

  return (
    <article
      className={cn('barrio-card', expandida && 'barrio-card--expandida')}
      role="button"
      tabIndex={0}
      aria-expanded={expandida}
      aria-label={`${nombre}: ${expandida ? 'minimizar tarjeta' : 'clic para ver histórico completo'}`}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button, .recharts-tooltip-wrapper')) return;
        onAlternar();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          const target = e.target as HTMLElement;
          if (target.tagName.toLowerCase() === 'button') return;
          e.preventDefault();
          onAlternar();
        }
      }}
    >
      <header className="barrio-card__cabecera">
        <div className="barrio-card__identidad">
          <h3 className="barrio-card__nombre">{nombre}</h3>
          {expandida && (
            <span className="barrio-card__subtitulo-expandido">
              {resumen ? `${resumen.primerAnio} – ${resumen.ultimoAnio} (${resumen.totalPuntos} trimestres)` : 'Histórico'}
            </span>
          )}
        </div>

        <span className="barrio-card__acciones">
          <span
            className={cn(
              'barrio-card__tendencia',
              subio12m && 'barrio-card__tendencia--sube',
              bajo12m && 'barrio-card__tendencia--baja'
            )}
            title={
              variacion == null
                ? 'Sin variación calculable'
                : `Variación de los últimos 12 meses: ${fmtPct(variacion)}`
            }
          >
            <TendenciaIcono className="barrio-card__tendencia-icono" aria-hidden />
            {variacion == null ? 's/d' : fmtPct(variacion)}
            <span className="barrio-card__tendencia-periodo">12m</span>
          </span>

          <button
            type="button"
            className="barrio-card__btn-expandir"
            onClick={(e) => {
              e.stopPropagation();
              onAlternar();
            }}
            aria-label={expandida ? 'Minimizar tarjeta' : 'Agrandar tarjeta y ver histórico'}
            title={expandida ? 'Minimizar' : 'Agrandar tarjeta'}
          >
            {expandida ? (
              <Minimize2 className="barrio-card__expandir-icono" aria-hidden />
            ) : (
              <Maximize2 className="barrio-card__expandir-icono" aria-hidden />
            )}
          </button>
        </span>
      </header>

      {!expandida && (
        <>
          {serie.length > 1 ? (
            <div className="barrio-card__mini-zona">
              <div
                className="barrio-card__rangos"
                role="group"
                aria-label="Rango de tiempo del gráfico"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className={cn('barrio-card__rango-btn', rangoMini === '4a' && 'barrio-card__rango-btn--activo')}
                  onClick={() => setRangoMini('4a')}
                  title="Últimos 4 años"
                >
                  4A
                </button>
                <button
                  type="button"
                  className={cn('barrio-card__rango-btn', rangoMini === '10a' && 'barrio-card__rango-btn--activo')}
                  onClick={() => setRangoMini('10a')}
                  title="Últimos 10 años"
                >
                  10A
                </button>
                <button
                  type="button"
                  className={cn('barrio-card__rango-btn', rangoMini === 'all' && 'barrio-card__rango-btn--activo')}
                  onClick={() => setRangoMini('all')}
                  title="Todo el histórico disponible"
                >
                  Todo
                </button>
                {varMini != null && (
                  <span
                    className={cn(
                      'barrio-card__var-rango',
                      subioMini ? 'barrio-card__var-rango--sube' : bajoMini ? 'barrio-card__var-rango--baja' : ''
                    )}
                  >
                    {fmtPct(varMini)}
                  </span>
                )}
              </div>

              <div className="barrio-card__grafico" style={{ height: 74 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={serieMini} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
                    <defs>
                      <linearGradient id={`grad-mini-${clave}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={colorMini} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={colorMini} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="p" hide />
                    <YAxis hide domain={dominioMini} />
                    <Tooltip content={<TooltipPeriodo sufijo={sufijo} />} />
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke={colorMini}
                      strokeWidth={2.25}
                      fill={`url(#grad-mini-${clave})`}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0, fill: colorMini }}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="barrio-card__meta">
                <span>{periodoTexto}</span>
                <span className="barrio-card__hint">Clic para ver el histórico completo</span>
              </div>
            </div>
          ) : (
            <div className="barrio-card__sin-dato">Sin serie histórica oficial para este barrio.</div>
          )}
        </>
      )}

      {expandida && (
        <div className="barrio-card__expandida-cuerpo" onClick={(e) => e.stopPropagation()}>
          <section className="barrio-card__bloque">
            <header className="barrio-card__bloque-cabecera">
              <div>
                <h4>Evolución histórica completa (All Time)</h4>
                <p className="barrio-card__bloque-desc">
                  Serie oficial desde {resumen ? resumen.primerAnio : '2006'} hasta {PERIODO_ACTUAL.replace('-T', ' T')} · {SERIE_ETIQUETA}
                </p>
              </div>
              {resumen?.variacionTotal != null && (
                <div
                  className={cn(
                    'barrio-card__var-total-chip',
                    resumen.variacionTotal >= 0 ? 'barrio-card__var-total-chip--sube' : 'barrio-card__var-total-chip--baja'
                  )}
                >
                  <TrendingUp className="barrio-card__chip-icono" aria-hidden />
                  <span>{fmtPct(resumen.variacionTotal)} acumulado total</span>
                </div>
              )}
            </header>

            {serie.length > 1 ? (
              <div className="barrio-card__grafico barrio-card__grafico--grande">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={serie} margin={{ top: 12, right: 12, bottom: 4, left: -6 }}>
                    <defs>
                      <linearGradient id={`grad-all-${clave}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0087c0" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#0087c0" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis
                      dataKey="p"
                      ticks={ticksAllTime}
                      tickFormatter={(p: string) => p.split('-T')[0]}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      minTickGap={16}
                    />
                    <YAxis
                      domain={dominioGrande}
                      axisLine={false}
                      tickLine={false}
                      width={56}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      tickFormatter={(v: number) => `$${Math.round(v).toLocaleString('es-AR')}`}
                    />
                    <Tooltip content={<TooltipPeriodo sufijo={sufijo} />} />
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke="#0087c0"
                      strokeWidth={2.5}
                      fill={`url(#grad-all-${clave})`}
                      dot={false}
                      activeDot={{ r: 5, fill: '#0087c0', stroke: '#fff', strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="barrio-card__sin-dato">Sin serie histórica oficial para este barrio.</div>
            )}

            {resumen && (
              <ul className="barrio-card__resumen">
                <li>
                  <small>Valor Vigente</small>
                  <strong>{formatear(criterio === 'venta' ? venta : alquiler, criterio)}</strong>
                  <span>{PERIODO_ACTUAL.replace('-T', ' T')}</span>
                </li>
                <li>
                  <small>Máximo Histórico</small>
                  <strong>${Math.round(resumen.maximo).toLocaleString('es-AR')} {sufijo.trim()}</strong>
                  <span>{resumen.maximoPeriodo}</span>
                </li>
                <li>
                  <small>Mínimo Histórico</small>
                  <strong>${Math.round(resumen.minimo).toLocaleString('es-AR')} {sufijo.trim()}</strong>
                  <span>{resumen.minimoPeriodo}</span>
                </li>
                <li>
                  <small>Variación desde {resumen.primerAnio}</small>
                  <strong className={cn(resumen.variacionTotal != null && resumen.variacionTotal < 0 && 'barrio-card__resumen--baja')}>
                    {resumen.variacionTotal == null ? '—' : fmtPct(resumen.variacionTotal)}
                  </strong>
                  <span>Total acumulado</span>
                </li>
              </ul>
            )}
          </section>

          <section className="barrio-card__bloque barrio-card__bloque--secundario">
            <header className="barrio-card__bloque-cabecera">
              <div>
                <h4>Cambio período a período</h4>
                <p className="barrio-card__bloque-desc">
                  Variación porcentual respecto al trimestre anterior
                </p>
              </div>

              <div className="barrio-card__rangos" role="group" aria-label="Períodos de variación">
                <button
                  type="button"
                  className={cn('barrio-card__rango-btn', limiteBarras === 12 && 'barrio-card__rango-btn--activo')}
                  onClick={() => setLimiteBarras(12)}
                >
                  3 años
                </button>
                <button
                  type="button"
                  className={cn('barrio-card__rango-btn', limiteBarras === 20 && 'barrio-card__rango-btn--activo')}
                  onClick={() => setLimiteBarras(20)}
                >
                  5 años
                </button>
                <button
                  type="button"
                  className={cn('barrio-card__rango-btn', limiteBarras === 0 && 'barrio-card__rango-btn--activo')}
                  onClick={() => setLimiteBarras(0)}
                >
                  Todo
                </button>
              </div>
            </header>

            {variacionesTrim.length > 0 ? (
              <div className="barrio-card__grafico barrio-card__grafico--barras">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={variacionesTrim} margin={{ top: 8, right: 8, bottom: 4, left: -14 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis
                      dataKey="etiqueta"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      width={44}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}%`}
                    />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 2" />
                    <Tooltip content={<TooltipVariacion />} cursor={{ fill: 'rgba(0,135,192,0.06)' }} />
                    <Bar dataKey="pct" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
                      {variacionesTrim.map((v) => (
                        <Cell
                          key={v.periodo}
                          fill={v.pct >= 0 ? '#16a34a' : '#dc2626'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="barrio-card__sin-dato">Sin datos suficientes para calcular variaciones de este barrio.</div>
            )}

            <p className="barrio-card__fuente">
              Fuente oficial: {SERIE_FUENTE} · {SERIE_ETIQUETA} · Último dato publicado: {PERIODO_ACTUAL.replace('-T', ' T')}.
              Los alquileres se calculan con el rendimiento de referencia (4,5% anual).
            </p>
          </section>
        </div>
      )}

      <footer className="barrio-card__pie">
        <div className="barrio-card__valor">
          <small>{criterio === 'venta' ? 'Venta estimada' : 'Alquiler estimado'}</small>
          <strong className="barrio-card__valor-principal">
            {formatear(criterio === 'venta' ? venta : alquiler, criterio)}
          </strong>
        </div>
      </footer>
    </article>
  );
};
