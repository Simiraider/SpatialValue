
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Bell,
  Heart,
  House,
  ExternalLink
} from 'lucide-react';

import { apiFetch } from '../lib/api';

import '../styles/notificaciones.css';

interface Notificacion {
  tipo: 'like' | 'propiedad';
  id: string;
  fecha: string;
  no_visto: boolean;

  emisor_id?: string;
  emisor_nombre?: string;
  emisor_avatar?: string;

  titulo?: string;
  barrio?: string;
  precio_usd?: number | string;
  superficie_m2?: number | string;
  ambientes?: number | null;
  url?: string;
}

const formatFecha = (iso: string) => {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);

  if (min < 1) return 'Ahora';
  if (min < 60) return `${min} min`;

  const horas = Math.floor(min / 60);
  if (horas < 24) return `${horas} h`;

  const dias = Math.floor(horas / 24);
  if (dias < 7) return `${dias} d`;

  return d.toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short'
  });
};

const iniciales = (nombre = 'Usuario') =>
  nombre.trim().split(/\s+/).slice(0, 1)
    .map(p => p[0]?.toUpperCase() ?? '').join('');

const precio = (valor?: number | string) =>
  valor == null
    ? ''
    : `USD ${Number(valor).toLocaleString('es-AR')}`;

interface Props {
  enSidebar?: boolean;
}

export const NotificationsBell = ({
  enSidebar = false
}: Props) => {
  const [abierta, setAbierta] = useState(false);
  const [notificaciones, setNotificaciones] =
    useState<Notificacion[]>([]);

  const [noVistos, setNoVistos] = useState(0);
  const [cargando, setCargando] = useState(false);

  const contenedorRef = useRef<HTMLDivElement | null>(null);

  const cargar = useCallback(async () => {
    try {
      const { ok, data } = await apiFetch(
        '/Apis/ObtenerNotificaciones',
        {},
        8000
      );

      if (ok && (data as any)?.success) {
        setNotificaciones(
          (data as any).notificaciones || []
        );

        setNoVistos(
          (data as any).no_vistos || 0
        );
      }
    } catch {
      // Conservamos el último estado.
    }
  }, []);

  useEffect(() => {
    cargar();

    const intervalo = setInterval(cargar, 60000);

    return () => clearInterval(intervalo);
  }, [cargar]);

  useEffect(() => {
    if (!abierta) return;

    const fuera = (e: MouseEvent) => {
      if (
        contenedorRef.current &&
        !contenedorRef.current.contains(e.target as Node)
      ) {
        setAbierta(false);
      }
    };

    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierta(false);
    };

    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', escape);

    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [abierta]);

  const abrir = async () => {
    const nueva = !abierta;

    setAbierta(nueva);

    if (nueva && noVistos > 0) {
      setCargando(true);

      try {
        await apiFetch(
          '/Apis/ObtenerNotificaciones',
          { method: 'POST' },
          8000
        );

        setNoVistos(0);

        setNotificaciones(prev =>
          prev.map(n => ({
            ...n,
            no_visto: false
          }))
        );

      } catch {
        // Se reintentará al volver a abrir.
      } finally {
        setCargando(false);
      }
    }
  };

  return (
    <div
      className={`notificaciones${enSidebar ? ' notificaciones--sidebar' : ''}`}
      ref={contenedorRef}
    >
      <button
        type="button"
        onClick={abrir}
        className="notificaciones__campana"
        aria-label={`Notificaciones${noVistos > 0 ? ` (${noVistos} sin ver)` : ''}`}
        aria-expanded={abierta}
      >
        <Bell className="notificaciones__campana-icono" />

        {noVistos > 0 && (
          <span className="notificaciones__contador">
            {noVistos > 9 ? '9+' : noVistos}
          </span>
        )}
      </button>

      {abierta && (
        <div
          className="notificaciones__desplegable"
          role="dialog"
          aria-label="Notificaciones"
        >
          <div className="notificaciones__cabecera">
            <p className="notificaciones__cabecera-titulo">
              Notificaciones
            </p>
          </div>

          {cargando ? (
            <p className="notificaciones__vacio">
              Cargando...
            </p>
          ) : notificaciones.length === 0 ? (
            <p className="notificaciones__vacio">
              Todavía no tenés notificaciones.
            </p>
          ) : (
            <ul className="notificaciones__lista">
              {notificaciones.map(n => (
                <li
                  key={n.id}
                  className={`notificaciones__item${n.no_visto ? ' notificaciones__item--nuevo' : ''}`}
                >
                  {n.tipo === 'like' ? (
                    <>
                      {n.emisor_avatar ? (
                        <img
                          src={n.emisor_avatar}
                          alt=""
                          className="notificaciones__item-avatar"
                        />
                      ) : (
                        <div className="notificaciones__item-iniciales">
                          {iniciales(n.emisor_nombre)}
                        </div>
                      )}

                      <div className="notificaciones__item-contenido">
                        <p className="notificaciones__item-texto">
                          <span className="notificaciones__item-nombre">
                            {n.emisor_nombre}
                          </span>
                          {' '}te agregó como amigo
                        </p>

                        <p className="notificaciones__item-fecha">
                          {formatFecha(n.fecha)}
                        </p>
                      </div>

                      <Heart className="notificaciones__item-corazon" />
                    </>
                  ) : (
                    <>
                      <div className="notificaciones__item-iniciales notificaciones__item-iniciales--propiedad">
                        <House size={18} />
                      </div>

                      <div className="notificaciones__item-contenido">
                        <p className="notificaciones__item-texto">
                          <span className="notificaciones__item-nombre">
                            Nueva oportunidad:
                          </span>
                          {' '}{n.titulo}
                        </p>

                        <p className="notificaciones__item-detalle">
                          {precio(n.precio_usd)}
                          {n.superficie_m2
                            ? ` · ${Number(n.superficie_m2)} m²`
                            : ''}
                          {n.ambientes
                            ? ` · ${n.ambientes} amb.`
                            : ''}
                        </p>

                        <p className="notificaciones__item-fecha">
                          {formatFecha(n.fecha)}
                        </p>

                        {n.url && (
                          <a
                            className="notificaciones__item-link"
                            href={n.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Ver publicación
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};