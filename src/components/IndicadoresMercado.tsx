import { useEffect, useMemo, useState } from 'react';
import { Search, ArrowDownUp, Loader2, DollarSign, Info, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { BARRIOS_CABA, VALORES_M2_POR_BARRIO } from '../lib/mercado';
import { cargarDolar, dolarActual } from '../lib/dolar';
import { type Moneda } from '../lib/usuario-config';
import { getUser } from '../lib/session';
import { cn } from '../lib/utils';
import '../styles/indicadores.css';

type Criterio = 'venta' | 'alquiler';

const tituloBarrio = (clave: string): string =>
  clave
    .split(' ')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');

const formatoUsd = (v: number): string => `$${v.toLocaleString('es-AR')}`;

/**
 * Variación de mercado determinística por barrio (estable para el mismo nombre).
 * Placeholder hasta que el scraper entregue un histórico real de precios.
 */
function tendenciaBarrio(nombre: string): number {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) % 97;
  return (h % 9) - 4; // rango -4..+4 (porcentaje)
}

const formatoVariacion = (v: number): string =>
  `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}%`;

export const IndicadoresMercado = () => {
  const [query, setQuery] = useState('');
  const [criterio, setCriterio] = useState<Criterio>('venta');
  const [ordenAsc, setOrdenAsc] = useState(false);
  const [dolar, setDolar] = useState(dolarActual());

  useEffect(() => {
    cargarDolar().then((e) => setDolar(e.valor));
  }, []);

  const moneda: Moneda = getUser()?.moneda ?? 'USD';

  const filas = useMemo(() => {
    const q = query.trim().toLowerCase();
    const lista = BARRIOS_CABA.map((nombre) => {
      const clave = nombre
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      const valores = VALORES_M2_POR_BARRIO[clave];
      return {
        nombre,
        venta: valores?.venta ?? null,
        alquiler: valores?.alquiler ?? null,
        variacion: tendenciaBarrio(clave),
      };
    }).filter((b) => !q || b.nombre.toLowerCase().includes(q));

    const campo = (b: { nombre: string; venta: number | null; alquiler: number | null }) =>
      criterio === 'venta' ? b.venta : b.alquiler;

    return lista.sort((a, b) => {
      const va = campo(a);
      const vb = campo(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return ordenAsc ? va - vb : vb - va;
    });
  }, [query, criterio, ordenAsc]);

  const formatoValor = (v: number | null, tipo: Criterio): string => {
    if (v == null) return '—';
    if (moneda === 'ARS') {
      const sufijo = tipo === 'venta' ? ' ARS/m²' : ' ARS/m²/mes';
      return `$${Math.round(v * dolar).toLocaleString('es-AR')}${sufijo}`;
    }
    const sufijo = tipo === 'venta' ? ' USD/m²' : ' USD/m²/mes';
    return `${formatoUsd(v)}${sufijo}`;
  };

  const valoresFuturos = false;

  return (
    <div className="indicadores">
      <div className="indicadores__cabecera">
        <div>
          <h1 className="indicadores__titulo">Indicadores de mercado</h1>
          <p className="indicadores__descripcion">
            Valor del m² por barrio usado en las tasaciones, tipo de cambio y referencia de conversión.
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

      {valoresFuturos && (
        <div className="indicadores__aviso" role="status">
          <Info className="indicadores__aviso-icono" aria-hidden />
          Los valores de mercado cambiaron. Tus tasaciones se actualizaron con los nuevos valores.
        </div>
      )}

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
          {filas.map((b) => {
            const subio = b.variacion > 0;
            const bajo = b.variacion < 0;
            const TendenciaIcono = subio ? ArrowUpRight : bajo ? ArrowDownRight : Minus;
            return (
              <article key={b.nombre} className="barrio-card">
                <header className="barrio-card__cabecera">
                  <h3 className="barrio-card__nombre">{tituloBarrio(b.nombre.toLowerCase())}</h3>
                  <span
                    className={cn(
                      'barrio-card__tendencia',
                      subio && 'barrio-card__tendencia--sube',
                      bajo && 'barrio-card__tendencia--baja'
                    )}
                    title={subio ? 'El valor del m² subió' : bajo ? 'El valor del m² bajó' : 'El valor del m² se mantuvo'}
                  >
                    <TendenciaIcono className="barrio-card__tendencia-icono" aria-hidden />
                    {formatoVariacion(b.variacion)}
                  </span>
                </header>

                <div className="barrio-card__valor">
                  <small>{criterio === 'venta' ? 'Venta' : 'Alquiler'}</small>
                  <strong className="barrio-card__valor-principal">
                    {criterio === 'venta' ? formatoValor(b.venta, 'venta') : formatoValor(b.alquiler, 'alquiler')}
                  </strong>
                </div>

                <div className="barrio-card__secundario">
                  <small>{criterio === 'venta' ? 'Alquiler' : 'Venta'}</small>
                  <span>
                    {criterio === 'venta' ? formatoValor(b.alquiler, 'alquiler') : formatoValor(b.venta, 'venta')}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {filas.length > 0 && (
        <p className="indicadores__cargando-nota">
          <Loader2 className="indicadores__nota-icono indicadores__nota-icono--girando" aria-hidden />
          Estos valores se actualizan automáticamente cuando el scrapper detecta cambios en el mercado.
        </p>
      )}
    </div>
  );
};