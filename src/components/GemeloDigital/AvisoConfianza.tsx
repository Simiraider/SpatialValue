import React from 'react';
import { calidadPorFotos } from '../../lib/gemelo';
import { cn } from '../../lib/utils';

const COLORES: Record<string, string> = {
  insuficiente: 'bg-slate-100 text-slate-600 border-slate-200',
  aproximado: 'bg-amber-50 text-amber-800 border-amber-200',
  moderado: 'bg-orange-50 text-orange-800 border-orange-200',
  bueno: 'bg-teal-50 text-teal-800 border-teal-200',
  alto: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

const BARRA: Record<string, string> = {
  insuficiente: 'bg-slate-400',
  aproximado: 'bg-amber-400',
  moderado: 'bg-orange-400',
  bueno: 'bg-teal-500',
  alto: 'bg-emerald-500',
};

interface Props {
  fotos: number;
  esVideo?: boolean;
}

export const AvisoConfianza = ({ fotos, esVideo = false }: Props) => {
  const info = calidadPorFotos(fotos);
  const visibles = esVideo ? 4 : info.nivel;

  return (
    <div
      className={cn(
        'rounded-2xl border p-4 transition-colors',
        COLORES[info.clave] || COLORES.insuficiente
      )}
      role="status"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">
          {esVideo ? 'Video' : info.etiqueta}
        </p>
        <span className="text-xs font-medium opacity-80">
          {esVideo ? '≈40 cuadros equivalentes' : `${fotos} fotos`}
        </span>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/10">
        <div
          className={cn('h-full rounded-full transition-all', BARRA[info.clave] || BARRA.insuficiente)}
          style={{ width: `${Math.max(8, (visibles / 4) * 100)}%` }}
        />
      </div>

      <p className="mt-2 text-sm opacity-90">
        {esVideo
          ? 'Los videos se convierten en cuadros (1 por segundo) y se reconstruyen igual que las fotos.'
          : info.mensaje}
      </p>
    </div>
  );
};
