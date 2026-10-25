import { useMemo } from 'react';
import { CheckCircle2, FolderOpen, Download, Building2 } from 'lucide-react';
import { type TasacionItem } from '../data/mock';

type Props = {
  tasaciones: TasacionItem[];
  onIr: (id: string) => void;
};

type Evento = {
  clave: string;
  id: string;
  icono: typeof CheckCircle2;
  tono: 'completada' | 'borrador' | 'descarga';
  texto: string;
  tiempo: number;
};

const fechaRelativa = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);
  const dias = Math.floor((inicioHoy.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (dias === 1) return 'ayer';
  if (dias < 7) return `hace ${dias} días`;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
};

const tiempoDe = (iso: string | null | undefined): number => {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
};

export const ActividadReciente = ({ tasaciones, onIr }: Props) => {
  const eventos = useMemo<Evento[]>(() => {
    const lista: Evento[] = [];
    for (const t of tasaciones) {
      const tiempo = tiempoDe(t.ultimaVez);
      if (!tiempo) continue;
      if (t.status === 'completada') {
        lista.push({
          clave: `${t.id}-completada`,
          id: t.id,
          icono: CheckCircle2,
          tono: 'completada',
          texto: `Completaste la tasación de ${t.address}`,
          tiempo,
        });
      } else {
        lista.push({
          clave: `${t.id}-borrador`,
          id: t.id,
          icono: FolderOpen,
          tono: 'borrador',
          texto: `Guardaste un borrador en ${t.address}`,
          tiempo,
        });
      }
    }
    return lista.sort((a, b) => b.tiempo - a.tiempo).slice(0, 6);
  }, [tasaciones]);

  if (eventos.length === 0) {
    return (
      <div className="actividad actividad--vacia">
        <p className="actividad__vacio-texto">Todavía no hay actividad. Creá una tasación para empezar.</p>
      </div>
    );
  }

  return (
    <ul className="actividad__lista">
      {eventos.map((ev) => {
        const Icono = ev.icono;
        const fecha = fechaRelativa(new Date(ev.tiempo).toISOString());
        return (
          <li key={ev.clave} className="actividad__item">
            <button type="button" className="actividad__boton" onClick={() => onIr(ev.id)}>
              <span className={`actividad__icono actividad__icono--${ev.tono}`}>
                <Icono aria-hidden />
              </span>
              <span className="actividad__cuerpo">
                <span className="actividad__texto">{ev.texto}</span>
                {fecha && <span className="actividad__fecha">{fecha}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
};
