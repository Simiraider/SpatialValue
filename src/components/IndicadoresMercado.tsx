import { useMemo, useState } from 'react';
import { Search, TrendingUp, ArrowDownUp, Loader2, DollarSign, Info } from 'lucide-react';
import { BARRIOS_CABA, VALORES_M2_POR_BARRIO, TASA_ARS_USD } from '../lib/mercado';
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

export const IndicadoresMercado = () => {
  const [query, setQuery] = useState('');
  const [criterio, setCriterio] = useState<Criterio>('venta');
  const [ordenAsc, setOrdenAsc] = useState(false);

  const moneda: Moneda = getUser()?.moneda ?? 'USD';
  const dolar = TASA_ARS_USD;

  const filas = useMemo(() => {
    const q = query.trim().toLowerCase();
    const lista = BARRIOS_CABA
      .map((nombre) => {
        const clave = nombre
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        const valores = VALORES_M2_POR_BARRIO[clave];
        return {
          nombre,
          venta: valores?.venta ?? null,
          alquiler: valores?.alquiler ?? null,
        };
      })
      .filter((b) => !q || b.nombre.toLowerCase().includes(q));

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
        <p className="indicadores__vacio">No encontramos barrios para tu búsqueda.</p>
      ) : (
        <div className="indicadores__tabla-envoltura">
          <table className="indicadores__tabla">
            <thead>
              <tr>
                <th scope="col" className="indicadores__tabla-col">Barrio</th>
                <th scope="col" className="indicadores__tabla-col indicadores__tabla-col--valor">
                  {criterio === 'venta' ? 'Valor m² venta' : 'Valor m² alquiler'}
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map((b) => (
                <tr key={b.nombre} className="indicadores__fila">
                  <td className="indicadores__celda">
                    <span className="indicadores__barrio">
                      <TrendingUp className="indicadores__barrio-icono" aria-hidden />
                      {tituloBarrio(b.nombre.toLowerCase())}
                    </span>
                  </td>
                  <td className="indicadores__celda indicadores__celda--valor">
                    {(() => {
                      const v = criterio === 'venta' ? b.venta : b.alquiler;
                      if (v == null) return '—';
                      if (moneda === 'ARS') {
                        const sufijo = criterio === 'venta' ? ' ARS/m²' : ' ARS/m²/mes';
                        return `$${Math.round(v * dolar).toLocaleString('es-AR')}${sufijo}`;
                      }
                      const sufijo = criterio === 'venta' ? ' USD/m²' : ' USD/m²/mes';
                      return `${formatoUsd(v)}${sufijo}`;
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
