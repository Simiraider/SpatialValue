import { useState } from 'react';
import { Bell, User, Search } from 'lucide-react';
import { tasacionesRecientes, borradores, type TasacionItem } from '../data/mock';
import '../styles/dashboard.css';

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

  const items =
    section === 'borradores'
      ? borradores
      : section === 'tasaciones'
        ? tasacionesRecientes
        : [];

  const filtered = items.filter((t) =>
    t.address.toLowerCase().includes(query.toLowerCase())
  );

  const isSearching = query.trim().length > 0;

  return (
    <div className="dashboard-layout">
      <aside className="dashboard-sidebar" aria-label="Menú principal">
        <a href="/" className="dashboard-brand">
          SpatialValue
        </a>
        <nav aria-label="Secciones">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`dashboard-nav-btn${section === item.id ? ' active' : ''}`}
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="dashboard-search">
            <label className="sr-only" htmlFor="buscar-tasacion">
              Buscar tasación
            </label>
            <Search className="dashboard-search-icon" />
            <input
              id="buscar-tasacion"
              type="search"
              placeholder="Buscar Tasación..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="dashboard-topbar-actions">
            <button type="button" className="dashboard-icon-btn" aria-label="Notificaciones">
              <Bell className="dashboard-icon" />
            </button>
            <button type="button" className="dashboard-icon-btn" aria-label="Perfil">
              <User className="dashboard-icon" />
            </button>
          </div>
        </header>

        <main className="dashboard-content">
          {section === 'indices' && (
            <p className="dashboard-placeholder">Índices de mercado — disponible en un próximo sprint.</p>
          )}
          {section === 'config' && (
            <p className="dashboard-placeholder">Configuración — disponible en un próximo sprint.</p>
          )}
          {(section === 'tasaciones' || section === 'borradores') && (
            <>
              <h1 className="dashboard-sectionTitle">
                {section === 'borradores' ? 'Mis borradores' : 'Mis tasaciones'}
              </h1>
              {filtered.length === 0 ? (
                <p className="dashboard-empty">
                  {isSearching
                    ? 'No hay resultados para tu búsqueda.'
                    : 'Todavía no tenés tasaciones aquí. ¡Creá una nueva!'}
                </p>
              ) : (
                <div className="tasacion-grid">
                  {filtered.map((t) => (
                    <a
                      key={t.id}
                      href={`/reporte?id=${t.id}`}
                      className={`tasacion-card tasacion-card--${t.status}`}
                    >
                      <div className="tasacion-card-header">
                        <h3>{t.address}</h3>
                        <span className={`tasacion-status tasacion-status--${t.status}`}>
                          {statusLabel[t.status]}
                        </span>
                      </div>
                      <p>{t.value}</p>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}

          <a href="/tasacion" className="fab-new" aria-label="Nueva tasación" title="Nueva tasación">
            +
          </a>
        </main>
      </div>
    </div>
  );
};
