import React, { useState } from 'react';
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
        <a href="/" className="block px-4 pb-4 font-bold text-slate-900 no-underline">
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
          <div className="dashboard-search relative">
            <label className="sr-only" htmlFor="buscar-tasacion">
              Buscar tasación
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="buscar-tasacion"
              type="search"
              placeholder="Buscar Tasación..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ paddingLeft: '2.25rem' }}
            />
          </div>
          <div className="dashboard-topbar-actions">
            <button type="button" className="dashboard-icon-btn" aria-label="Notificaciones">
              <Bell className="h-5 w-5" />
            </button>
            <button type="button" className="dashboard-icon-btn" aria-label="Perfil">
              <User className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="dashboard-content">
          {section === 'indices' && (
            <p className="text-slate-600">Índices de mercado — disponible en un próximo sprint.</p>
          )}
          {section === 'config' && (
            <p className="text-slate-600">Configuración — disponible en un próximo sprint.</p>
          )}
          {(section === 'tasaciones' || section === 'borradores') && (
            <>
              <h1 className="mb-4 text-xl font-bold text-slate-900">
                {section === 'borradores' ? 'Mis borradores' : 'Mis tasaciones'}
              </h1>
              {filtered.length === 0 ? (
                <p className="text-slate-500">No hay resultados para tu búsqueda.</p>
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
