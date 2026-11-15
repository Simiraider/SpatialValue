
import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

import {
  BellRing,
  Trash2,
  Pause,
  Play,
  Plus,
  LoaderCircle
} from 'lucide-react';

import { apiFetch } from '../lib/api';

import '../styles/alertas-busqueda.css';

type Alerta = {
  id_alerta: string;
  nombre: string;
  barrio: string | null;
  tipo_propiedad: string | null;
  precio_min_usd: number | null;
  precio_max_usd: number | null;
  superficie_min_m2: number | null;
  superficie_max_m2: number | null;
  ambientes_min: number | null;
  ambientes_max: number | null;
  activa: boolean;
};

const inicial = {
  nombre: '',
  barrio: '',
  tipo_propiedad: '',
  precio_min_usd: '',
  precio_max_usd: '',
  superficie_min_m2: '',
  superficie_max_m2: '',
  ambientes_min: '',
  ambientes_max: ''
};

export default function AlertasBusqueda() {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [form, setForm] = useState(inicial);

  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);

    try {
      const { ok, data } = await apiFetch(
        '/Apis/GestionarAlertas',
        {},
        10000
      );

      if (!ok) {
        throw new Error(
          (data as any)?.error || 'No se pudieron cargar las alertas'
        );
      }

      setAlertas((data as any).alertas || []);

    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Error de conexión'
      );
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const cambiar = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    setForm(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const crear = async (e: FormEvent) => {
    e.preventDefault();

    setError('');
    setMensaje('');
    setGuardando(true);

    const payload: Record<string, string | number | null> = {
      ...form
    };

    for (const key of Object.keys(payload)) {
      const value = payload[key];

      if (typeof value === 'string' && value.trim() === '') {
        payload[key] = null;
      } else if (
        typeof value === 'string' &&
        !['nombre', 'barrio', 'tipo_propiedad'].includes(key)
      ) {
        payload[key] = Number(value);
      }
    }

    try {
      const { ok, data } = await apiFetch(
        '/Apis/GestionarAlertas',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        },
        12000
      );

      if (!ok) {
        throw new Error(
          (data as any)?.error || 'No se pudo crear la alerta'
        );
      }

      setForm(inicial);

      setMensaje(
        'Búsqueda guardada correctamente. Se evaluará cuando el scraper incorpore propiedades nuevas.'
      );

      await cargar();

    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Error al guardar'
      );
    } finally {
      setGuardando(false);
    }
  };

  const cambiarEstado = async (alerta: Alerta) => {
    setError('');

    try {
      const { ok, data } = await apiFetch(
        '/Apis/GestionarAlertas',
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            id_alerta: alerta.id_alerta,
            activa: !alerta.activa
          })
        },
        10000
      );

      if (!ok) {
        throw new Error(
          (data as any)?.error || 'No se pudo actualizar'
        );
      }

      await cargar();

    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Error al actualizar'
      );
    }
  };

  const eliminar = async (alerta: Alerta) => {
    if (!window.confirm(
      `¿Eliminar la alerta "${alerta.nombre}"?`
    )) return;

    setError('');

    try {
      const { ok, data } = await apiFetch(
        '/Apis/GestionarAlertas',
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            id_alerta: alerta.id_alerta
          })
        },
        10000
      );

      if (!ok) {
        throw new Error(
          (data as any)?.error || 'No se pudo eliminar'
        );
      }

      await cargar();

    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Error al eliminar'
      );
    }
  };

  return (
    <section className="alertas-busqueda">

      <header className="alertas-busqueda__header">
        <div className="alertas-busqueda__icono">
          <BellRing size={21} />
        </div>

        <div>
          <h2>Alertas inmobiliarias</h2>
          <p>
            Recibí notificaciones cuando aparezcan propiedades
            que coincidan con tus búsquedas.
          </p>
        </div>
      </header>

      <form
        className="alertas-busqueda__form"
        onSubmit={crear}
      >
        <h3>
          <Plus size={17} />
          Crear búsqueda
        </h3>

        <label>
          Nombre de la alerta
          <input
            name="nombre"
            value={form.nombre}
            onChange={cambiar}
            placeholder="Departamentos en Palermo"
            maxLength={100}
          />
        </label>

        <div className="alertas-busqueda__grid">

          <label>
            Barrio
            <input
              name="barrio"
              value={form.barrio}
              onChange={cambiar}
              placeholder="Palermo"
            />
          </label>

          <label>
            Tipo de propiedad
            <select
              name="tipo_propiedad"
              value={form.tipo_propiedad}
              onChange={cambiar}
            >
              <option value="">Cualquiera</option>
              <option value="Departamento">Departamento</option>
              <option value="Casa">Casa</option>
              <option value="PH">PH</option>
            </select>
          </label>

          <label>
            Precio mínimo (USD)
            <input
              type="number"
              min="0"
              name="precio_min_usd"
              value={form.precio_min_usd}
              onChange={cambiar}
              placeholder="Sin mínimo"
            />
          </label>

          <label>
            Precio máximo (USD)
            <input
              type="number"
              min="0"
              name="precio_max_usd"
              value={form.precio_max_usd}
              onChange={cambiar}
              placeholder="Sin máximo"
            />
          </label>

          <label>
            Superficie mínima (m²)
            <input
              type="number"
              min="1"
              step="0.1"
              name="superficie_min_m2"
              value={form.superficie_min_m2}
              onChange={cambiar}
              placeholder="Sin mínimo"
            />
          </label>

          <label>
            Superficie máxima (m²)
            <input
              type="number"
              min="1"
              step="0.1"
              name="superficie_max_m2"
              value={form.superficie_max_m2}
              onChange={cambiar}
              placeholder="Sin máximo"
            />
          </label>

          <label>
            Ambientes mínimos
            <input
              type="number"
              min="0"
              max="30"
              name="ambientes_min"
              value={form.ambientes_min}
              onChange={cambiar}
              placeholder="Sin mínimo"
            />
          </label>

          <label>
            Ambientes máximos
            <input
              type="number"
              min="0"
              max="30"
              name="ambientes_max"
              value={form.ambientes_max}
              onChange={cambiar}
              placeholder="Sin máximo"
            />
          </label>

        </div>

        <button
          className="alertas-busqueda__submit"
          type="submit"
          disabled={guardando}
        >
          {guardando
            ? <LoaderCircle className="spin" size={16} />
            : <Plus size={16} />
          }

          Guardar alerta
        </button>
      </form>

      {error && (
        <p className="alertas-busqueda__error" role="alert">
          {error}
        </p>
      )}

      {mensaje && (
        <p className="alertas-busqueda__success" role="status">
          {mensaje}
        </p>
      )}

      <div className="alertas-busqueda__listado">

        <h3>Mis búsquedas guardadas</h3>

        {cargando ? (
          <p>Cargando alertas...</p>
        ) : alertas.length === 0 ? (
          <p>Todavía no guardaste ninguna búsqueda.</p>
        ) : (
          alertas.map(alerta => (
            <article
              className="alertas-busqueda__item"
              key={alerta.id_alerta}
            >
              <div className="alertas-busqueda__item-info">

                <strong>{alerta.nombre}</strong>

                <span>
                  {[
                    alerta.barrio,
                    alerta.tipo_propiedad,
                    alerta.precio_max_usd
                      ? `Hasta USD ${Number(alerta.precio_max_usd).toLocaleString('es-AR')}`
                      : null,
                    alerta.superficie_min_m2
                      ? `Desde ${alerta.superficie_min_m2} m²`
                      : null
                  ].filter(Boolean).join(' · ')}
                </span>

                <small className={
                  alerta.activa ? 'is-active' : 'is-paused'
                }>
                  {alerta.activa ? 'Activa' : 'Pausada'}
                </small>

              </div>

              <div className="alertas-busqueda__acciones">

                <button
                  type="button"
                  onClick={() => cambiarEstado(alerta)}
                  title={alerta.activa ? 'Pausar' : 'Activar'}
                >
                  {alerta.activa
                    ? <Pause size={17} />
                    : <Play size={17} />
                  }
                </button>

                <button
                  type="button"
                  onClick={() => eliminar(alerta)}
                  title="Eliminar"
                >
                  <Trash2 size={17} />
                </button>

              </div>
            </article>
          ))
        )}

      </div>
    </section>
  );
}
