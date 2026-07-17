import { useState, useEffect } from 'react';
import { Bell, Search, Loader2 } from 'lucide-react';
import { borradores, type TasacionItem } from '../data/mock';
import { Card } from './ui/Card';
import { cn } from '../lib/utils';

type Section = 'tasaciones' | 'borradores' | 'indices' | 'config';

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

export const DashboardApp = () => {
  const [section, setSection] = useState<Section>('tasaciones');
  const [query, setQuery] = useState('');
  const [tasacionesApi, setTasacionesApi] = useState<TasacionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTasaciones = async () => {
      setLoading(true);
      try {
        const getCookie = (name: string) => {
          const value = `; ${document.cookie}`;
          const parts = value.split(`; ${name}=`);
          if (parts.length === 2) return parts.pop()?.split(';').shift();
          return null;
        };
        const usuarioId = getCookie('usuario_id');
        const url = usuarioId
          ? `/Apis/ObtenerDatosPropiedades?usuario_id=${usuarioId}`
          : `/Apis/ObtenerDatosPropiedades`;

        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            const mapped: TasacionItem[] = data.map((p: any) => ({
              id: String(p.id),
              address: p.direccion || p.titulo,
              value: p.precio ? `$${p.precio}` : '0 USD',
              status: 'completada' as const
            }));
            setTasacionesApi(mapped);
          }
        }
      } catch (error) {
        console.error("Error fetching properties", error);
      } finally {
        setLoading(false);
      }
    };
    fetchTasaciones();
  }, []);

  const items =
    section === 'borradores'
      ? borradores
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
            <button type="button" className="p-2 transition-colors" aria-label="Perfil">
              <div className="w-10 h-10 rounded-full bg-cyan-100 flex items-center justify-center text-cyan-700 font-bold">
                U
              </div>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8 relative z-0 pb-24">
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
              
              {loading && section === 'tasaciones' ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-10 h-10 animate-spin text-cyan-500" />
                </div>
              ) : filtered.length === 0 ? (
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
                    <a
                      key={t.id}
                      href={`/reporte?id=${t.id}`}
                      className="group"
                    >
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
                  ))}
                </div>
              )}
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
