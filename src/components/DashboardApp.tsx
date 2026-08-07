import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Search, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { borradores, type TasacionItem } from '../data/mock';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { cn } from '../lib/utils';
import { apiFetch, getCookie } from '../lib/api';
import { estimarPrecioVenta } from '../lib/mercado';
import { getUser, getUsuarioId, cerrarSesion, syncSessionAcrossTabs, type SesionUsuario } from '../lib/session';

type Section = 'tasaciones' | 'borradores' | 'indices' | 'config';
type CargaStatus = 'loading' | 'error' | 'ready';

const sidebarItems: { id: Section; label: string }[] = [
  { id: 'tasaciones', label: 'Mis tasaciones' },
  { id: 'borradores', label: 'Borradores' },
  { id: 'indices', label: 'Índices de Mercado' },
  { id: 'config', label: 'Configuración' },
];

const statusLabel: Record<TasacionItem['status'], string> = {
  completada: 'Completada',
  borrador: 'Borrador',
};

const getInitials = (nombre: string) =>
  nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

export const DashboardApp = () => {
  const [section, setSection] = useState<Section>('tasaciones');
  const [query, setQuery] = useState('');
  const [tasacionesApi, setTasacionesApi] = useState<TasacionItem[]>([]);
  const [status, setStatus] = useState<CargaStatus>('loading');
  const [user, setUser] = useState<SesionUsuario | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [borradoresState, setBorradoresState] = useState<TasacionItem[]>(borradores);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setUser(getUser());
    if (!getCookie('usuario_id') && !getUser()) {
      window.location.href = '/login';
      return;
    }

    setCheckingSession(false);

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
            let value: string;
            if (esAlq) {
              value =
                typeof p.precio === 'number' && p.precio > 0
                  ? `$${p.precio.toLocaleString('es-AR')}`
                  : 'A tasar';
            } else {
              const supCub = Number(p.superficie_cubierta) || 0;
              const supDesc = Math.max((Number(p.superficie_total) || 0) - supCub, 0);
              value = supCub > 0
                ? `$${estimarPrecioVenta(supCub, supDesc, p.barrio || p.ciudad).toLocaleString('es-AR')}`
                : 'A tasar';
            }
            return {
              id: String(p.id_publicacion ?? p.id),
              address: p.direccion || p.titulo || 'Sin dirección',
              value,
              status: 'completada' as const,
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

  const handleDelete = async (t: TasacionItem) => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    setDeletingId(t.id);
    try {
      if (section === 'borradores') {
        setBorradoresState((prev) => prev.filter((x) => x.id !== t.id));
        return;
      }

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

  if (checkingSession) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F5F5F5]">
        <Loader2 className="w-10 h-10 animate-spin text-cyan-500" />
      </div>
    );
  }

  const items =
    section === 'borradores'
      ? borradoresState
      : section === 'tasaciones'
        ? tasacionesApi
        : [];

  const filtered = items.filter((t) =>
    t.address.toLowerCase().includes(query.toLowerCase())
  );

  const isSearching = query.trim().length > 0;

  return (
    <div className="flex h-screen bg-[#F5F5F5] font-sans overflow-hidden">
      <aside className="w-64 bg-slate-900 text-white flex flex-col" aria-label="Menú principal">
        <div className="p-6 mt-4">
          <a href="/" className="text-2xl font-bold text-white tracking-tight">SpatialValue</a>
        </div>
        <nav className="flex-1 px-4 space-y-2 mt-4" aria-label="Secciones">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                "w-full flex items-center px-4 py-3 text-sm font-medium rounded-xl transition-colors",
                section === item.id
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              )}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shadow-sm z-10">
          <div className="flex-1 max-w-xl">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                id="buscar-tasacion"
                type="search"
                placeholder="Buscar Tasación..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-[#F5F5F5] rounded-full pl-12 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-shadow border-0"
              />
            </div>
          </div>
          <div className="flex items-center gap-4 ml-4">
            <button type="button" className="p-2 text-slate-400 hover:text-slate-600 transition-colors" aria-label="Notificaciones">
              <Bell className="w-6 h-6" />
            </button>
            {user && (
              <button
                type="button"
                onClick={() => cerrarSesion('/')}
                className="text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors"
              >
                Salir
              </button>
            )}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-cyan-100 flex items-center justify-center text-cyan-700 font-bold">
                {user ? getInitials(user.nombre) : 'U'}
              </div>
              {user && (
                <span className="text-sm font-semibold text-slate-700 hidden sm:block">
                  {user.nombre}
                </span>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8 relative z-0 pb-24">
          {user?.demo && (
            <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
              <strong>Modo demo:</strong> no se pudo conectar con el servidor. Estás viendo datos de ejemplo.
            </div>
          )}

          {section === 'indices' && (
            <Card className="text-center py-12">
              <p className="text-slate-500 text-lg">Índices de mercado — disponible en un próximo sprint.</p>
            </Card>
          )}
          {section === 'config' && (
            <Card className="text-center py-12">
              <p className="text-slate-500 text-lg">Configuración — disponible en un próximo sprint.</p>
            </Card>
          )}

          {(section === 'tasaciones' || section === 'borradores') && (
            <>
              <h1 className="text-3xl font-bold text-slate-900 mb-8">
                {section === 'borradores' ? 'Mis borradores' : 'Mis tasaciones'}
              </h1>

              {section === 'tasaciones' && status === 'loading' && (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-10 h-10 animate-spin text-cyan-500" />
                </div>
              )}

              {section === 'tasaciones' && status === 'error' && !user?.demo && (
                <Card className="text-center py-12">
                  <p className="text-slate-500 text-lg mb-1">
                    No pudimos conectar con el servidor para cargar tus tasaciones.
                  </p>
                  <p className="text-slate-400 text-sm mb-6">
                    Revisá tu conexión o intentá de nuevo en unos segundos.
                  </p>
                  <Button type="button" variant="outline" onClick={fetchTasaciones} id="btn-reintentar">
                    <RefreshCw className="w-4 h-4 mr-2" aria-hidden />
                    Reintentar
                  </Button>
                </Card>
              )}

              {(section === 'borradores' || status === 'ready' || (status === 'error' && user?.demo)) && (filtered.length === 0 ? (
                <Card className="text-center py-12">
                  <p className="text-slate-500 text-lg">
                    {isSearching
                      ? 'No hay resultados para tu búsqueda.'
                      : 'Todavía no tenés tasaciones aquí. ¡Creá una nueva!'}
                  </p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {filtered.map((t) => (
                    <div key={t.id} className="group relative">
                      <a href={`/reporte?id=${t.id}`} className="block h-full">
                        <Card className="h-full hover:shadow-md transition-shadow border border-transparent group-hover:border-cyan-200 p-6 flex flex-col justify-between cursor-pointer">
                          <div>
                            <div className="flex items-start justify-between mb-4">
                              <span className={cn(
                                "text-xs font-semibold px-3 py-1 rounded-full",
                                t.status === 'completada' ? "bg-teal-100 text-teal-700" : "bg-yellow-100 text-yellow-700"
                              )}>
                                {statusLabel[t.status]}
                              </span>
                            </div>
                            <h3 className="font-semibold text-lg text-slate-800 line-clamp-2 leading-snug">{t.address}</h3>
                          </div>
                          <div className="mt-6 pt-4 border-t border-slate-100">
                            <p className="text-2xl font-bold text-slate-900">{t.value}</p>
                          </div>
                        </Card>
                      </a>

                      {confirmingId === t.id ? (
                        <div
                          className="absolute top-3 right-3 z-20 flex items-center gap-1.5 rounded-xl bg-white shadow-lg border border-slate-200 px-2 py-1.5"
                          role="dialog"
                          aria-label={`Confirmar eliminación de ${t.address}`}
                        >
                          <span className="text-xs font-medium text-slate-600 whitespace-nowrap">¿Eliminar?</span>
                          <button
                            type="button"
                            id={`btn-confirmar-borrar-${t.id}`}
                            disabled={deletingId === t.id}
                            onClick={() => handleDelete(t)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-semibold px-2.5 py-1.5 transition-colors disabled:opacity-60 disabled:cursor-wait"
                          >
                            {deletingId === t.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" aria-hidden />
                            )}
                            {deletingId === t.id ? 'Borrando…' : 'Borrar'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelConfirm}
                            className="rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 text-xs font-medium px-2 py-1.5 transition-colors"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startConfirm(t.id)}
                          className="absolute top-3 right-3 z-10 p-2 rounded-lg bg-white/80 backdrop-blur border border-slate-200 shadow-sm text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all opacity-70 hover:opacity-100"
                          aria-label={`Eliminar tasación de ${t.address}`}
                          title="Eliminar tasación"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}

          <a
            href="/tasacion"
            className="fixed bottom-8 right-8 w-16 h-16 bg-cyan-500 hover:bg-cyan-600 text-white rounded-full flex items-center justify-center text-4xl font-light shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-1 z-50"
            aria-label="Nueva tasación"
            title="Nueva tasación"
          >
            +
          </a>
        </main>
      </div>
    </div>
  );
};
