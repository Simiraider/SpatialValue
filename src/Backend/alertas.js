
import sql from './carga.js';

let esquemaPromise = null;

export async function asegurarEsquemaAlertas() {
  if (!esquemaPromise) {
    esquemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS alertas_busqueda (
          id_alerta UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          id_usuario UUID NOT NULL,
          nombre VARCHAR(100) NOT NULL DEFAULT 'Mi búsqueda',
          barrio VARCHAR(80),
          tipo_propiedad VARCHAR(40),
          precio_min_usd INTEGER,
          precio_max_usd INTEGER,
          superficie_min_m2 NUMERIC(10,2),
          superficie_max_m2 NUMERIC(10,2),
          ambientes_min INTEGER,
          ambientes_max INTEGER,
          activa BOOLEAN NOT NULL DEFAULT TRUE,
          creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          actualizada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),

          CHECK (
            precio_min_usd IS NULL OR precio_max_usd IS NULL
            OR precio_min_usd <= precio_max_usd
          ),
          CHECK (
            superficie_min_m2 IS NULL OR superficie_max_m2 IS NULL
            OR superficie_min_m2 <= superficie_max_m2
          ),
          CHECK (
            ambientes_min IS NULL OR ambientes_max IS NULL
            OR ambientes_min <= ambientes_max
          )
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS alertas_busqueda_usuario_idx
        ON alertas_busqueda (id_usuario, activa)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS alertas_notificaciones (
          id_notificacion UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          id_alerta UUID NOT NULL
            REFERENCES alertas_busqueda(id_alerta)
            ON DELETE CASCADE,
          id_usuario UUID NOT NULL,
          id_propiedad VARCHAR(100) NOT NULL,
          titulo VARCHAR(180) NOT NULL,
          barrio VARCHAR(80),
          tipo_propiedad VARCHAR(40),
          precio_usd INTEGER,
          superficie_m2 NUMERIC(10,2),
          ambientes INTEGER,
          url TEXT,
          creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          vista BOOLEAN NOT NULL DEFAULT FALSE,

          UNIQUE (id_alerta, id_propiedad)
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS alertas_notificaciones_usuario_idx
        ON alertas_notificaciones (id_usuario, creada_en DESC)
      `;
    })().catch(error => {
      esquemaPromise = null;
      throw error;
    });
  }

  return esquemaPromise;
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

export function normalizarFiltros(body = {}) {
  const texto = (valor, max = 80) => {
    if (valor == null || String(valor).trim() === '') {
      return null;
    }

    return String(valor).trim().slice(0, max);
  };

  const numero = (valor, opciones = {}) => {
    if (valor == null || valor === '') return null;

    const {
      min = 0,
      max = Number.MAX_SAFE_INTEGER,
      entero = false
    } = opciones;

    const n = Number(valor);

    if (
      !Number.isFinite(n) ||
      n < min ||
      n > max ||
      (entero && !Number.isInteger(n))
    ) {
      throw new Error('Uno de los filtros numéricos es inválido.');
    }

    return n;
  };

  const filtros = {
    nombre: texto(body.nombre, 100) || 'Mi búsqueda',
    barrio: texto(body.barrio),
    tipo_propiedad: texto(body.tipo_propiedad, 40),

    precio_min_usd: numero(body.precio_min_usd, {
      min: 0, max: 20000000, entero: true
    }),

    precio_max_usd: numero(body.precio_max_usd, {
      min: 0, max: 20000000, entero: true
    }),

    superficie_min_m2: numero(body.superficie_min_m2, {
      min: 1, max: 50000
    }),

    superficie_max_m2: numero(body.superficie_max_m2, {
      min: 1, max: 50000
    }),

    ambientes_min: numero(body.ambientes_min, {
      min: 0, max: 30, entero: true
    }),

    ambientes_max: numero(body.ambientes_max, {
      min: 0, max: 30, entero: true
    })
  };

  const pares = [
    ['precio_min_usd', 'precio_max_usd'],
    ['superficie_min_m2', 'superficie_max_m2'],
    ['ambientes_min', 'ambientes_max']
  ];

  for (const [min, max] of pares) {
    if (
      filtros[min] !== null &&
      filtros[max] !== null &&
      filtros[min] > filtros[max]
    ) {
      throw new Error(`El mínimo de ${min} supera el máximo.`);
    }
  }

  const tieneFiltro = Object.entries(filtros)
    .some(([key, value]) => key !== 'nombre' && value !== null);

  if (!tieneFiltro) {
    throw new Error('Debés completar al menos un criterio.');
  }

  return filtros;
}
