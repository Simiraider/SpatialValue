import { useState } from 'react';
import { Bell, User, Search } from 'lucide-react';
import { tasacionesRecientes, borradores } from '../data/mock';
import '../styles/dashboard.css';

type Section = 'tasaciones' | 'borradores' | 'indices' | 'config';

const sidebarItems: { id: Section; label: string }[] = [
  { id: 'tasaciones', label: 'Mis tasaciones' },
  { id: 'borradores', label: 'Borradores' },
  { id: 'indices', label: 'Índices de Mercado' },
  { id: 'config', label: 'Configuración' },
];

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

  return (
    <div className="dashboard-layout">
      <aside className="dashboard-sidebar" aria-label="Menú principal">
        <a href="/" className="dashboard-brand">
          SpatialValue
        </a>
        {sidebarItems.map((item) => (
          <a
            key={item.id}
            href="#"
            className={section === item.id ? 'active' : ''}
            onClick={(e) => {
              e.preventDefault();
              setSection(item.id);
            }}
          >
            {item.label}
          </a>
        ))}
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
                <p className="dashboard-empty">No hay resultados para tu búsqueda.</p>
              ) : (
                <div className="tasacion-grid">
                  {filtered.map((t) => (
                    <a key={t.id} href="/reporte" className="tasacion-card">
                      <h3>{t.address}</h3>
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



