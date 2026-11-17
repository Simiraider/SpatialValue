import sql from './src/Backend/carga.js';

async function setup() {
  try {
    console.log('🔨 Creando tabla visor3d_trabajos en Neon...');
    await sql`
      CREATE TABLE IF NOT EXISTS "visor3d_trabajos" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "usuario_id" uuid NOT NULL,
        "publicacion_id" uuid,
        "estado" text NOT NULL DEFAULT 'pendiente',
        "etapa" text NOT NULL DEFAULT 'inicio',
        "progreso" integer DEFAULT 0,
        "mensaje" text,
        "calidad" text DEFAULT 'media',
        "proveedor" text DEFAULT 'kiri',
        "proveedor_ref" text,
        "modelo_path" text,
        "modelo_bytes" bigint,
        "error" text,
        "creado_en" timestamptz NOT NULL DEFAULT NOW(),
        "chequeo_en" timestamptz,
        "expira_en" timestamptz
      )
    `;
    
    await sql`
      CREATE INDEX IF NOT EXISTS "visor3d_trabajos_usuario_idx" 
      ON "visor3d_trabajos" ("usuario_id", "creado_en" DESC)
    `;

    console.log('✅ Tabla creada exitosamente.');
  } catch (e) {
    console.error('💥 Error creando la tabla:', e);
  }
}

setup();
