# Spatial Value

Plataforma de tasacion automatizada de propiedades que combina datos de mercado, variables macroeconomicas y analisis de imagenes para generar reportes tecnicos mas precisos.

## Problema

En el mercado inmobiliario, la tasacion suele depender mucho del factor humano, usa comparables que pueden estar desactualizados y muchas veces no detecta irregularidades en la propiedad o diferencias entre superficie declarada y real.

Spatial Value busca reducir esa incertidumbre con una herramienta profesional de tasacion automatizada.

## Solucion

- Completar un formulario con datos de la propiedad
- Generar un reporte preliminar
- Estimar un rango de precios
- Visualizar graficos interactivos
- Incorporar analisis de imagenes para futuras versiones
- Evolucionar hacia un visor 3D de la propiedad

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Astro 6 |
| UI | React 19 + TypeScript |
| Styling | Tailwind CSS 4 |
| 3D | Three.js + React Three Fiber |
| Backend | Node.js + Express |
| Database | PostgreSQL + Supabase |
| AI/Data | Python + Selenium |

## Getting Started

```bash
npm install
npm run dev
```

## Project Structure

```
src/
├── components/
│   ├── ui/          # Button, Input, Card, Container, Badge
│   ├── layout/      # Navbar, Sidebar, Footer
│   └── forms/       # Form-specific components
├── layouts/         # MainLayout
├── pages/           # File-based routing
│   ├── index.astro        # Home
│   ├── login.astro        # Login
│   ├── dashboard.astro    # Dashboard
│   └── valuation.astro    # Valuation form
├── styles/          # Global CSS + design tokens
├── hooks/           # Custom React hooks
├── lib/             # Core libraries and configs
├── services/        # API and external service calls
├── stores/          # State management
├── types/           # TypeScript type definitions
├── utils/           # Utility functions
└── constants/       # App-wide constants
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |
| `npm run format` | Format with Prettier |
| `npm run typecheck` | Run TypeScript checks |
| `npm run check` | Run all checks |

## Environment Variables

```bash
cp .env.example .env
```

## Team

- Simon Flomenboim - Frontend
- Jonas Leiserson - Backend
- Liam Lutteral - IA
- Manuel Smulovitz - UX/UI

## Roadmap

- **Sprint 1:** Cimientos y definicion
- **Sprint 2:** Estructuracion del flujo, preguntas y datos
- **Sprint 3:** Finalizado del maquetado y logica principal
- **Sprint 4:** Integracion de datos, reportes e inteligencia
- **Sprint 5:** Refinamiento y realidad aumentada opcional
- **Sprint 6:** Pulido, testeo y entrega final

## License

Proyecto academico en desarrollo.
