import { useState, useEffect } from 'react';
import { Search, Loader2, ChevronRight, Home } from 'lucide-react';
import { borradores, type TasacionItem } from '../data/mock';
import { getCookie } from '../lib/utils';
import '../styles/dashboard.css';

const statusLabel: Record<TasacionItem['status'], string> = {
  completada: 'Completada',
  borrador: 'Borrador',
};

export const DashboardApp = () => {
  const [query, setQuery] = useState('');
  const [tasacionesApi, setTasacionesApi] = useState<TasacionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const fetchTasaciones = async () => {
      setLoading(true);
      try {
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

  const allItems = [...tasacionesApi, ...borradores];
  const filtered = allItems.filter((t) =>
    t.address.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="dash-wrap">
      <div className="dash-profile-card">
        <div className="dash-profile-left">
          <div className="dash-avatar-circle"></div>
          <div className="dash-profile-info">
            <h2 className="dash-profile-name">Lorem Ipsum</h2>
            <div className="dash-profile-detail">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              <span>usuario@email.com</span>
            </div>
            <div className="dash-profile-detail">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <span>Dirección de ejemplo 1234</span>
            </div>
            <div className="dash-profile-detail">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span>Miembro desde 2025</span>
            </div>
          </div>
        </div>
        <div className="dash-profile-right">
          <div className="dash-medal">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>
          </div>
          <button className="dash-profile-btn">Ver Perfil</button>
        </div>
      </div>

      <div className="dash-search-section">
        <div className="dash-search-bar">
          <Search className="dash-search-icon" size={18} />
          <input
            type="search"
            placeholder="Buscar Propiedad..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          className={`dash-sidebar-toggle ${sidebarOpen ? 'dash-sidebar-toggle--open' : ''}`}
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title={sidebarOpen ? 'Cerrar panel' : 'Abrir historial'}
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="dash-content-wrap">
        <div className="dash-grid-wrap">
          {loading ? (
            <div className="dash-loading">
              <Loader2 size={32} className="dash-spinner" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="dash-empty">
              {query ? 'No hay resultados para tu búsqueda.' : 'Todavía no tenés propiedades. ¡Creá una nueva tasación!'}
            </p>
          ) : (
            <div className="dash-grid">
              {filtered.map((t) => (
                <a
                  key={t.id}
                  href={`/reporte?id=${t.id}`}
                  className={`dash-prop-card dash-prop-card--${t.status}`}
                >
                  <div className="dash-prop-icon">
                    <Home size={24} />
                  </div>
                  <div className="dash-prop-info">
                    <h3 className="dash-prop-address">{t.address}</h3>
                    <p className="dash-prop-meta">
                      {t.status === 'completada' ? '3 Amb. | 75 M²' : 'Borrador'}
                    </p>
                  </div>
                  <span className={`dash-status-badge dash-status-badge--${t.status}`}>
                    {statusLabel[t.status]}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>

        {sidebarOpen && (
          <aside className="dash-sidebar-panel">
            <h3 className="dash-sidebar-title">Mis tasaciones</h3>
            <div className="dash-sidebar-list">
              {filtered.slice(0, 5).map((t) => (
                <a key={t.id} href={`/reporte?id=${t.id}`} className="dash-sidebar-item">
                  <span className="dash-sidebar-item-name">{t.address}</span>
                  <span className={`dash-sidebar-item-status dash-sidebar-item-status--${t.status}`}></span>
                </a>
              ))}
            </div>
            <div className="dash-sidebar-settings">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </div>
          </aside>
        )}
      </div>

      <a href="/formulario" className="dash-fab">+</a>
    </div>
  );
};
