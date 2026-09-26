import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Loader2, RefreshCw, Trash2, Download, CheckCircle2, Undo2, SlidersHorizontal, PanelLeftClose, PanelLeftOpen, Settings, Home, Building2, ChevronDown, LogOut, UserRound, FolderOpen, ChartColumn, Users, Plus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
import { IndicadoresMercado } from './IndicadoresMercado';
import { NotificationsBell } from './NotificationsBell';
import { esConfigUsuario, formatValor, type Moneda } from '../lib/usuario-config';
import '../styles/dashboard.css';

type Section = 'tasaciones' | 'borradores' | 'indicadores' | 'config' | 'comunidad';
type Orden = 'predeterminado' | 'recientes' | 'mayor-precio' | 'menor-precio' | 'mas-antiguo';
type CargaStatus = 'loading' | 'error' | 'ready';

const sidebarItems: { id: Section; label: string; icono: LucideIcon }[] = [
  { id: 'tasaciones', label: 'Mis tasaciones', icono: Home },
  { id: 'borradores', label: 'Mis borradores', icono: FolderOpen },
  { id: 'indicadores', label: 'Indicadores de mercado', icono: ChartColumn },
  { id: 'comunidad', label: 'Comunidad', icono: Users },
];

const opcionesOrden: { id: Orden; label: string }[] = [
  { id: 'predeterminado', label: 'Predeterminado' },
  { id: 'recientes', label: 'Recientes' },
  { id: 'mayor-precio', label: 'Mayor precio' },
  { id: 'menor-precio', label: 'Menor precio' },
  { id: 'mas-antiguo', label: 'Más antiguo' },
];

const statusLabel: Record<TasacionItem['status'], string> = {
  completada: 'Lista para tasar',
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
  if (min < 60) return `Últ. vez abierto: hace ${min} min`;
  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);
  const dias = Math.floor((inicioHoy.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (dias === 1) {
    return `Últ. vez abierto: ayer a las ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (dias > 1 && dias < 7) return `Últ. vez abierto: hace ${dias} días`;
  return `Últ. vez abierto: ${d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}`;
};

const fechaTasacion = (t: TasacionItem): number => {
  if (!t.ultimaVez) return Number.NaN;
  const tiempo = new Date(t.ultimaVez).getTime();
  return Number.isNaN(tiempo) ? Number.NaN : tiempo;
};

const ordenarTasaciones = (lista: TasacionItem[], orden: Orden): TasacionItem[] => {
  const copia = [...lista];
  switch (orden) {
    case 'recientes':
      return copia.sort((a, b) => (fechaTasacion(b) || 0) - (fechaTasacion(a) || 0));
    case 'mas-antiguo':
      return copia.sort((a, b) => {
        const fa = fechaTasacion(a);
        const fb = fechaTasacion(b);
        if (Number.isNaN(fa) && Number.isNaN(fb)) return 0;
        if (Number.isNaN(fa)) return 1;
        if (Number.isNaN(fb)) return -1;
        return fa - fb;
      });
    case 'mayor-precio':
      return copia.sort((a, b) => (b.valorUsd ?? -Infinity) - (a.valorUsd ?? -Infinity));
    case 'menor-precio':
      return copia.sort((a, b) => {
        const va = a.valorUsd;
        const vb = b.valorUsd;
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return va - vb;
      });
    default:
      return copia;
  }
};

export const DashboardApp = () => {
  const [section, setSection] = useState<Section>('tasaciones');
  const [query, setQuery] = useState('');
  const [orden, setOrden] = useState<Orden>('predeterminado');
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [perfilAbierto, setPerfilAbierto] = useState(false);
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
  const filtrosRef = useRef<HTMLDivElement | null>(null);
  const perfilRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!filtrosAbiertos) return;
    const onClickFuera = (e: MouseEvent) => {
      if (filtrosRef.current && !filtrosRef.current.contains(e.target as Node)) {
        setFiltrosAbiertos(false);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFiltrosAbiertos(false);
    };
    document.addEventListener('mousedown', onClickFuera);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickFuera);
      document.removeEventListener('keydown', onEscape);
    };
  }, [filtrosAbiertos]);

  useEffect(() => {
    if (!perfilAbierto) return;
    const onClickFuera = (e: MouseEvent) => {
      if (perfilRef.current && !perfilRef.current.contains(e.target as Node)) {
        setPerfilAbierto(false);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPerfilAbierto(false);
    };
    document.addEventListener('mousedown', onClickFuera);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickFuera);
      document.removeEventListener('keydown', onEscape);
    };
  }, [perfilAbierto]);

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

  const filtradas = items.filter((t) =>
    t.address.toLowerCase().includes(query.toLowerCase())
  );

  const lista = ordenarTasaciones(filtradas, orden);

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
      <header className="dashboard__cabecera">
        <a href="/" className="dashboard__cabecera-marca" aria-label="SpatialValue - Inicio">
          <img src="/logo.svg" alt="SpatialValue" className="dashboard__logo-img" />
        </a>

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
            onClick={() => (window.location.href = '/tasacion')}
            className="dashboard__boton-nueva"
          >
            <Plus className="dashboard__boton-nueva-icono" aria-hidden />
            <span className="dashboard__boton-nueva-texto">Nueva Tasación</span>
          </button>

          <div className="filtros" ref={filtrosRef}>
            <button
              type="button"
              className={cn("dashboard__boton-filtros", filtrosAbiertos && "dashboard__boton-filtros--activo")}
              aria-label="Filtros"
              aria-haspopup="listbox"
              aria-expanded={filtrosAbiertos}
              onClick={() => setFiltrosAbiertos((v) => !v)}
            >
              <SlidersHorizontal className="dashboard__boton-filtros-icono" aria-hidden />
              Filtros
            </button>

            {filtrosAbiertos && (
              <div className="filtros__desplegable" role="listbox" aria-label="Ordenar tasaciones">
                {opcionesOrden.map((op) => (
                  <button
                    key={op.id}
                    type="button"
                    role="option"
                    aria-selected={orden === op.id}
                    className={cn("filtros__opcion", orden === op.id && "filtros__opcion--activa")}
                    onClick={() => {
                      setOrden(op.id);
                      setFiltrosAbiertos(false);
                    }}
                  >
                    {op.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {user && (
            <div className="dashboard__perfil" ref={perfilRef}>
              <button
                type="button"
                className="dashboard__perfil-gatillo"
                aria-haspopup="menu"
                aria-expanded={perfilAbierto}
                aria-label="Abrir menú de usuario"
                onClick={() => setPerfilAbierto((v) => !v)}
              >
                {avatar ? (
                  <img src={avatar} alt="Avatar" className="dashboard__perfil-avatar" />
                ) : (
                  <span className="dashboard__perfil-iniciales">{getInitials(user.nombre)}</span>
                )}
                <span className="dashboard__perfil-nombre">{user.nombre}</span>
                <ChevronDown
                  className={cn("dashboard__perfil-flecha", perfilAbierto && "dashboard__perfil-flecha--abierta")}
                  aria-hidden
                />
              </button>

              {perfilAbierto && (
                <div className="dashboard__menu-perfil" role="menu" aria-label="Menú de usuario">
                  <div className="dashboard__menu-perfil-cabecera">
                    <p className="dashboard__menu-perfil-nombre">{user.nombre}</p>
                    {user.demo && <p className="dashboard__menu-perfil-demo">Modo demo</p>}
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    className="dashboard__menu-perfil-item"
                    onClick={() => {
                      setPerfilAbierto(false);
                      setSection('config');
                    }}
                  >
                    <UserRound className="dashboard__menu-perfil-item-icono" aria-hidden />
                    Mi Perfil
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="dashboard__menu-perfil-item dashboard__menu-perfil-item--salir"
                    onClick={() => cerrarSesion('/')}
                  >
                    <LogOut className="dashboard__menu-perfil-item-icono" aria-hidden />
                    Cerrar sesión
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="dashboard__cuerpo">
        <aside className="dashboard__sidebar" aria-label="Menú principal">
          <div className="dashboard__sidebar-superior">
            <NotificationsBell enSidebar />
          </div>

          <nav className="dashboard__sidebar-nav" aria-label="Secciones">
            {sidebarItems.map((item) => {
              const Icono = item.icono;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    "dashboard__nav-item",
                    section === item.id && "dashboard__nav-item--activo"
                  )}
                  onClick={() => setSection(item.id)}
                >
                  <Icono className="dashboard__nav-item-icono" aria-hidden />
                  <span className="dashboard__nav-item-texto">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="dashboard__sidebar-pie">
            <button
              type="button"
              onClick={() => setSection('config')}
              className={cn(
                "dashboard__boton-config",
                section === 'config' && "dashboard__boton-config--activo"
              )}
              aria-label="Configuración"
              aria-pressed={section === 'config'}
              title="Configuración"
            >
              <Settings className="dashboard__boton-config-icono" aria-hidden />
            </button>
          </div>
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

        <main className="dashboard__principal">
          {user?.demo && (
            <div className="dashboard__aviso-demo">
              <strong>Modo demo:</strong> no se pudo conectar con el servidor. Estás viendo datos de ejemplo.
            </div>
          )}

          {section === 'comunidad' && <BuscarUsuarios />}
          {section === 'indicadores' && <IndicadoresMercado />}
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
                  <Button type="button" variant="outline" onClick={fetchTasaciones} id="boton-reintentar-error">
                    <RefreshCw className="w-4 h-4 mr-2" aria-hidden />
                    Reintentar
                  </Button>
                </div>
              )}

              {(status === 'ready' || (status === 'error' && user?.demo)) && (lista.length === 0 ? (
                <div className="dashboard__vacio">
                  <p className="dashboard__vacio-texto">
                    {isSearching
                      ? 'No hay resultados para tu búsqueda.'
                      : section === 'borradores'
                        ? 'No tenés borradores. Podés guardar una tasación como borrador al crearla.'
                        : 'Todavía no tenés tasaciones aquí. ¡Creá una nueva con el botón "+ Nueva Tasación"!'}
                  </p>
                </div>
              ) : (
                <div className="dashboard__grilla">
                  {lista.map((t) => (
                    <div key={t.id} className="dashboard__item">
                      <a href={`/reporte?id=${t.id}`} className="dashboard__tarjeta-enlace">
                        <article className="dashboard__tarjeta">
                          <div className="dashboard__tarjeta-principal">
                            <div className="dashboard__tarjeta-identidad">
                              {t.tipo === 'Casa' ? (
                                <Home className="dashboard__tarjeta-icono" aria-hidden />
                              ) : (
                                <Building2 className="dashboard__tarjeta-icono" aria-hidden />
                              )}
                              <h3 className="dashboard__tarjeta-direccion">{t.address}</h3>
                            </div>
                            <div className="dashboard__tarjeta-acciones">
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
