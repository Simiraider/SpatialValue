import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Loader2, RefreshCw, Trash2, Download, CheckCircle2, Undo2, SlidersHorizontal, PanelLeftClose, PanelLeftOpen, Home, Building2 } from 'lucide-react';
import { type TasacionItem } from '../data/mock';
import { Button } from './ui/Button';
import { cn } from '../lib/utils';
import { apiFetch, getCookie } from '../lib/api';
import { estimarPrecioVenta, valorM2Alquiler, TASA_ARS_USD } from '../lib/mercado';
import { getUser, getUsuarioId, cerrarSesion, syncSessionAcrossTabs, actualizarSesion, type SesionUsuario } from '../lib/session';
import { generarInformePdf } from '../lib/generar-pdf';
import { normalizeData } from '../lib/normalizar-tasacion';
import { ConfigPanel } from './ConfigPanel';
import { BuscarUsuarios } from './BuscarUsuarios';
import { NotificationsBell } from './NotificationsBell';
import { esConfigUsuario, formatValor, type Moneda } from '../lib/usuario-config';
import '../styles/dashboard.css';

type Section = 'tasaciones' | 'borradores' | 'config' | 'comunidad';
type CargaStatus = 'loading' | 'error' | 'ready';

const sidebarItems: { id: Section; label: string }[] = [
  { id: 'tasaciones', label: 'Mis tasaciones' },
  { id: 'borradores', label: 'Borradores' },
  { id: 'config', label: 'Configuración' },
  { id: 'comunidad', label: 'Comunidad' },
];

const statusLabel: Record<TasacionItem['status'], string> = {
  completada: 'Tasación lista a tasar',
  borrador: 'Borrador',
};

const getInitials = (nombre: string) =>
  nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

const formatUltimaVez = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'Últ. vez abierto: ahora';
  if (min < 60) return `Últ. vez abierto: ayer a las ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
  return `Últ. vez abierto: ${d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}`;
};

export const DashboardApp = () => {
  const [section, setSection] = useState<Section>('tasaciones');
  const [query, setQuery] = useState('');
  const [tasacionesApi, setTasacionesApi] = useState<TasacionItem[]>([]);
  const [status, setStatus] = useState<CargaStatus>('loading');
  const [user, setUser] = useState<SesionUsuario | null>(null);
  const [moneda, setMoneda] = useState<Moneda>('USD');
  const [avatar, setAvatar] = useState('');
  const [checkingSession, setCheckingSession] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const u = getUser();
    setUser(u);
    setMoneda(u?.moneda ?? 'USD');
    setAvatar(u?.avatar ?? '');
    if (!getCookie('usuario_id') || !getUser()) {
      window.location.href = '/login';
      return;
    }

    setCheckingSession(false);

    apiFetch('/Apis/ObtenerConfigUsuario', {}, 8000).then(({ ok, data }) => {
      if (ok && esConfigUsuario((data as any)?.config)) {
        setMoneda((data as any).config.moneda);
        setAvatar((data as any).config.avatar || '');
        actualizarSesion({ moneda: (data as any).config.moneda, avatar: (data as any).config.avatar || undefined });
      } else if ((data as any)?.sesion_expirada) {
        cerrarSesion('/login');
      }
    }).catch(() => {});

    return syncSessionAcrossTabs(() => {
      window.location.href = '/';
    });
  }, []);

  const fetchTasaciones = useCallback(async () => {
    setStatus('loading');
    try {
      const usuarioId = getUsuarioId();
      const url = usuarioId
        ? `/Apis/ObtenerDatosPropiedades?usuario_id=${usuarioId}`
        : '/Apis/ObtenerDatosPropiedades';

      const { ok, data } = await apiFetch(url, {}, 8000);

      if (ok && Array.isArray(data)) {
        const mapped: TasacionItem[] = data
          .filter((p: any) => p && p.id_publicacion !== undefined && p.id_publicacion !== null)
          .map((p: any) => {
            const esAlq = String(p.tipo_operacion).toLowerCase() === 'alquiler';
            let valorUsd: number | null = null;
            if (esAlq) {
              const supCubAlq = Number(p.superficie_cubierta) || 0;
              const precioIA = Number(p.precio_estimado_ia);
              if (precioIA > 0) {
                valorUsd = Math.round(precioIA * 0.045 / 12);
              } else if (supCubAlq > 0) {
                valorUsd = Math.round(supCubAlq * valorM2Alquiler(p.barrio || p.ciudad));
              }
            } else {
              const precioIA = Number(p.precio_estimado_ia);
              if (precioIA > 0) {
                valorUsd = Math.round(precioIA);
              } else {
                const supCub = Number(p.superficie_cubierta) || 0;
                const supDesc = Math.max((Number(p.superficie_total) || 0) - supCub, 0);
                if (supCub > 0) {
                  valorUsd = estimarPrecioVenta(supCub, supDesc, p.barrio || p.ciudad);
                }
              }
            }
            return {
              id: String(p.id_publicacion ?? p.id),
              address: p.direccion || p.titulo || 'Sin dirección',
              value: valorUsd !== null ? formatValor(valorUsd, 'USD') : 'A tasar',
              valorUsd,
              esAlquiler: esAlq,
              status: p.estado_tasacion === 'borrador' ? ('borrador' as const) : ('completada' as const),
              tipo: String(p.tipo_propiedad || '').toLowerCase().startsWith('casa') ? ('Casa' as const) : ('Departamento' as const),
              ultimaVez: p.fecha_modificacion || p.fecha_creacion || p.created_at || null,
            };
          });
        setTasacionesApi(mapped);
        setStatus('ready');
      } else {
        console.warn('ObtenerDatosPropiedades: respuesta inesperada', { ok, status: (data as any)?.status, data });
        setStatus('error');
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        console.warn('ObtenerDatosPropiedades tardó demasiado');
      } else {
        console.error('Error fetching properties', error);
      }
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (checkingSession) return;
    fetchTasaciones();
  }, [fetchTasaciones, checkingSession]);

  useEffect(() => () => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!confirmingId) return;
    document.getElementById(`btn-confirmar-borrar-${confirmingId}`)?.focus();
  }, [confirmingId]);

  const startConfirm = (id: string) => {
    setConfirmingId(id);
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    confirmTimeoutRef.current = setTimeout(() => setConfirmingId(null), 4000);
  };

  const cancelConfirm = () => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    setConfirmingId(null);
  };

  const handleToggleEstado = async (t: TasacionItem) => {
    setTogglingId(t.id);
    try {
      const nuevoEstado = t.status === 'borrador' ? 'completada' : 'borrador';
      const { ok, data: resData } = await apiFetch(
        '/Apis/ActualizarEstadoTasacion',
        {
          method: 'POST',
          body: JSON.stringify({
            id_publicacion: t.id,
            estado_tasacion: nuevoEstado,
            usuario_id: getUsuarioId() ?? undefined,
          }),
        },
        8000
      );

      if (!ok) {
        const serverError = (resData as any)?.error;
        console.error('ActualizarEstadoTasacion: respuesta inesperada', { ok, serverError });
        alert(
          serverError
            ? `No se pudo actualizar la tasación. ${serverError}`
            : 'No se pudo actualizar la tasación. Intentá de nuevo.'
        );
        return;
      }

      setTasacionesApi((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, status: nuevoEstado as TasacionItem['status'] } : x))
      );
    } catch (error) {
      console.error('Error al actualizar el estado de la tasación', error);
      alert('No se pudo actualizar la tasación. Intentá de nuevo.');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (t: TasacionItem) => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    setDeletingId(t.id);
    try {
      const { ok, data: resData } = await apiFetch(
        '/Apis/BorrarPropiedades',
        {
          method: 'DELETE',
          body: JSON.stringify({
            id_publicacion: t.id,
            usuario_id: getUsuarioId() ?? undefined,
          }),
        },
        8000
      );

      if (!ok) {
        const serverError = (resData as any)?.error;
        console.error('BorrarPropiedades: respuesta inesperada', { ok, serverError });
        alert(
          serverError
            ? `No se pudo eliminar la tasación. ${serverError}`
            : 'No se pudo eliminar la tasación. Intentá de nuevo.'
        );
        return;
      }

      setTasacionesApi((prev) => prev.filter((x) => x.id !== t.id));
    } catch (error) {
      console.error('Error al eliminar tasación', error);
      alert('No se pudo eliminar la tasación. Intentá de nuevo.');
    } finally {
      setConfirmingId(null);
      setDeletingId(null);
    }
  };

  const handleDownloadPdf = async (t: TasacionItem) => {
    setDownloadingId(t.id);
    try {
      const usuarioId = getUsuarioId();
      const qs = usuarioId ? `&usuario_id=${encodeURIComponent(usuarioId)}` : '';
      const { ok, data: resData } = await apiFetch(
        `/Apis/ObtenerTasacion?id=${encodeURIComponent(t.id)}${qs}`,
        {},
        8000
      );
      if (!ok || !resData) {
        alert('No se pudieron cargar los datos para generar el PDF.');
        return;
      }
      const datosNormalizados = normalizeData(resData);
      if (!datosNormalizados) {
        alert('Los datos de la tasación no pudieron procesarse.');
        return;
      }
      await generarInformePdf(datosNormalizados, getUser()?.nombre);
    } catch (error) {
      console.error('Error al generar PDF', error);
      alert('No se pudo generar el PDF. Intentá de nuevo.');
    } finally {
      setDownloadingId(null);
    }
  };

  if (checkingSession) {
    return (
      <div className="dashboard dashboard--cargando">
        <Loader2 className="dashboard__spinner" />
      </div>
    );
  }

  const items =
    section === 'borradores'
      ? tasacionesApi.filter((t) => t.status === 'borrador')
      : tasacionesApi.filter((t) => t.status === 'completada');

  const filtered = items.filter((t) =>
    t.address.toLowerCase().includes(query.toLowerCase())
  );

  const isSearching = query.trim().length > 0;

  const formatear = (usd: number, alquiler = false) => {
    if (alquiler) {
      if (moneda === 'ARS') {
        return `$${Math.round(usd * TASA_ARS_USD).toLocaleString('es-AR')} ARS/mes`;
      }
      return `$${Math.round(usd).toLocaleString('es-AR')} USD/mes`;
    }
    return formatValor(usd, moneda);
  };

  return (
    <div className={cn("dashboard", !sidebarVisible && "dashboard--sidebar-oculto")}>
      <div className="dashboard__sidebar-zona">
        <aside className="dashboard__sidebar" aria-label="Menú principal">
          <div className="dashboard__sidebar-marca">
            <a href="/" className="dashboard__logo">SpatialValue</a>
          </div>
        <nav className="dashboard__sidebar-nav" aria-label="Secciones">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                "dashboard__nav-item",
                section === item.id && "dashboard__nav-item--activo"
              )}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <button
        type="button"
        onClick={() => setSidebarVisible((v) => !v)}
        className="dashboard__boton-panel"
        aria-label={sidebarVisible ? 'Ocultar menú' : 'Mostrar menú'}
        aria-expanded={sidebarVisible}
        title={sidebarVisible ? 'Ocultar menú' : 'Mostrar menú'}
      >
        {sidebarVisible ? (
          <PanelLeftClose className="dashboard__boton-panel-icono" aria-hidden />
        ) : (
          <PanelLeftOpen className="dashboard__boton-panel-icono" aria-hidden />
        )}
      </button>
      </div>

      <div className="dashboard__contenido">
        <header className="dashboard__cabecera">
          <div className="dashboard__buscador-zona">
            <div className="dashboard__buscador">
              <Search className="dashboard__buscador-icono" aria-hidden />
              <input
                id="buscar-tasacion"
                type="search"
                placeholder="Buscar Tasación..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="dashboard__buscador-entrada"
              />
            </div>
          </div>
          <div className="dashboard__cabecera-acciones">
            <button
              type="button"
              className="dashboard__boton-filtros"
              aria-label="Filtros"
            >
              <SlidersHorizontal className="dashboard__boton-filtros-icono" aria-hidden />
              Filtros
            </button>
            <NotificationsBell />
            {user && (
              <button
                type="button"
                onClick={() => cerrarSesion('/')}
                className="dashboard__boton-salir"
              >
                Salir
              </button>
            )}
            <button
              type="button"
              onClick={() => setSection('config')}
              className="dashboard__perfil"
              aria-label="Abrir configuración"
              title="Configuración"
            >
              {avatar ? (
                <img src={avatar} alt="Avatar" className="dashboard__perfil-avatar" />
              ) : (
                <div className="dashboard__perfil-iniciales">
                  {user ? getInitials(user.nombre) : 'U'}
                </div>
              )}
              {user && (
                <span className="dashboard__perfil-nombre">
                  {user.nombre}
                </span>
              )}
            </button>
          </div>
        </header>

        <main className="dashboard__principal">
          {user?.demo && (
            <div className="dashboard__aviso-demo">
              <strong>Modo demo:</strong> no se pudo conectar con el servidor. Estás viendo datos de ejemplo.
            </div>
          )}

          {section === 'comunidad' && <BuscarUsuarios />}
          {section === 'config' && (
            <ConfigPanel
              user={user}
              onUserActualizado={(u) => {
                setUser(u);
                setMoneda(u.moneda ?? 'USD');
                setAvatar(u.avatar ?? '');
              }}
            />
          )}

          {(section === 'tasaciones' || section === 'borradores') && (
            <div className="dashboard__panel">
              <button
                type="button"
                onClick={() => (window.location.href = '/tasacion')}
                className="dashboard__boton-nueva"
                aria-label="Nueva tasación"
                title="Nueva tasación"
              >
                +
              </button>

              {status === 'loading' && (
                <div className="dashboard__cargando">
                  <Loader2 className="dashboard__spinner" />
                </div>
              )}

              {status === 'error' && !user?.demo && (
                <div className="dashboard__error">
                  <p className="dashboard__error-titulo">
                    No pudimos conectar con el servidor para cargar tus tasaciones.
                  </p>
                  <p className="dashboard__error-detalle">
                    Revisá tu conexión o intentá de nuevo en unos segundos.
                  </p>
                  <Button type="button" variant="outline" onClick={fetchTasaciones} id="btn-reintentar">
                    <RefreshCw className="w-4 h-4 mr-2" aria-hidden />
                    Reintentar
                  </Button>
                </div>
              )}

              {(status === 'ready' || (status === 'error' && user?.demo)) && (filtered.length === 0 ? (
                <div className="dashboard__vacio">
                  <p className="dashboard__vacio-texto">
                    {isSearching
                      ? 'No hay resultados para tu búsqueda.'
                      : section === 'borradores'
                        ? 'No tenés borradores. Podés guardar una tasación como borrador al crearla.'
                        : 'Todavía no tenés tasaciones aquí. ¡Creá una nueva!'}
                  </p>
                </div>
              ) : (
                <div className="dashboard__grilla">
                  {filtered.map((t) => (
                    <div key={t.id} className="dashboard__item">
                      <a href={`/reporte?id=${t.id}`} className="dashboard__tarjeta-enlace">
                        <article className="dashboard__tarjeta">
                          <div className="dashboard__tarjeta-fila">
                            {t.tipo === 'Casa' ? (
                              <Home className="dashboard__tarjeta-icono" aria-hidden />
                            ) : (
                              <Building2 className="dashboard__tarjeta-icono" aria-hidden />
                            )}
                            <h3 className="dashboard__tarjeta-direccion">{t.address}</h3>
                            {t.status === 'completada' && (
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDownloadPdf(t); }}
                                disabled={downloadingId === t.id}
                                className="dashboard__tarjeta-accion"
                                aria-label="Descargar informe PDF"
                                title="Descargar PDF"
                              >
                                {downloadingId === t.id ? (
                                  <Loader2 className="dashboard__tarjeta-accion-icono dashboard__tarjeta-accion-icono--cargando" />
                                ) : (
                                  <Download className="dashboard__tarjeta-accion-icono" />
                                )}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); startConfirm(t.id); }}
                              className="dashboard__tarjeta-accion dashboard__tarjeta-accion--peligro"
                              aria-label={`Eliminar tasación de ${t.address}`}
                              title="Eliminar tasación"
                            >
                              <Trash2 className="dashboard__tarjeta-accion-icono" aria-hidden />
                            </button>
                          </div>
                          <div className="dashboard__tarjeta-pie">
                            <span className="dashboard__tarjeta-fecha">
                              {formatUltimaVez(t.ultimaVez) ?? (t.valorUsd != null ? formatear(t.valorUsd, t.esAlquiler) : t.value)}
                            </span>
                            <span className={cn(
                              "dashboard__tarjeta-estado",
                              t.status === 'completada'
                                ? "dashboard__tarjeta-estado--lista"
                                : "dashboard__tarjeta-estado--borrador"
                            )}>
                              {statusLabel[t.status]}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleToggleEstado(t); }}
                              disabled={togglingId === t.id}
                              className={cn(
                                "dashboard__tarjeta-estado-accion",
                                t.status !== 'borrador' && "dashboard__tarjeta-estado-accion--lista"
                              )}
                              aria-label={t.status === 'borrador' ? 'Marcar como completada' : 'Mover a borradores'}
                              title={t.status === 'borrador' ? 'Marcar como completada' : 'Mover a borradores'}
                            >
                              {togglingId === t.id ? (
                                <Loader2 className="dashboard__tarjeta-estado-accion-icono dashboard__tarjeta-estado-accion-icono--cargando" />
                              ) : t.status === 'borrador' ? (
                                <CheckCircle2 className="dashboard__tarjeta-estado-accion-icono" />
                              ) : (
                                <Undo2 className="dashboard__tarjeta-estado-accion-icono" />
                              )}
                            </button>
                          </div>
                        </article>
                      </a>

                      {confirmingId === t.id && (
                        <div
                          className="dashboard__confirmar"
                          role="dialog"
                          aria-label={`Confirmar eliminación de ${t.address}`}
                        >
                          <span className="dashboard__confirmar-pregunta">¿Eliminar?</span>
                          <button
                            type="button"
                            id={`btn-confirmar-borrar-${t.id}`}
                            disabled={deletingId === t.id}
                            onClick={() => handleDelete(t)}
                            className="dashboard__confirmar-borrar"
                          >
                            {deletingId === t.id ? (
                              <Loader2 className="dashboard__confirmar-borrar-icono dashboard__confirmar-borrar-icono--cargando" aria-hidden />
                            ) : (
                              <Trash2 className="dashboard__confirmar-borrar-icono" aria-hidden />
                            )}
                            {deletingId === t.id ? 'Borrando…' : 'Borrar'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelConfirm}
                            className="dashboard__confirmar-cancelar"
                          >
                            Cancelar
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
