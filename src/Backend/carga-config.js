import { neon } from '@neondatabase/serverless';

const connectionString =
  import.meta.env.CONFIG_DATABASE_URL ||
  process.env.CONFIG_DATABASE_URL ||
  import.meta.env.SpatialValueStorage_DATABASE_URL ||
  process.env.SpatialValueStorage_DATABASE_URL;

if (!connectionString) {
  throw new Error('CONFIG_DATABASE_URL no está definida. Revisá el archivo .env.local');
}

const sql = neon(connectionString);

let promesaEsquema = null;

async function crearEsquema() {
  await sql`
    CREATE TABLE IF NOT EXISTS "usuarios" (
      "id_usuario" uuid PRIMARY KEY,
      "nombre" varchar(100) NOT NULL,
      "email" varchar(200) NOT NULL,
      "contraseña" text NOT NULL DEFAULT ''
    )
  `;
  await sql`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "telefono" varchar(30) NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "avatar" text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "instagram" varchar(100) NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "twitter" varchar(100) NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "linkedin" varchar(200) NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "facebook" varchar(200) NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "sitio_web" varchar(300) NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "instagram_publico" boolean NOT NULL DEFAULT true`;
  await sql`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "twitter_publico" boolean NOT NULL DEFAULT true`;
  await sql`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "linkedin_publico" boolean NOT NULL DEFAULT true`;
  await sql`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "facebook_publico" boolean NOT NULL DEFAULT true`;
  await sql`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "sitio_publico" boolean NOT NULL DEFAULT true`;
  await sql`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "perfil_publico" boolean NOT NULL DEFAULT true`;
  await sql`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "mostrar_contacto" boolean NOT NULL DEFAULT true`;
  await sql`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "visibilidad_estadisticas" boolean NOT NULL DEFAULT true`;
  await sql`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "moneda" varchar(3) NOT NULL DEFAULT 'USD'`;
  await sql`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "cuenta_activa" boolean NOT NULL DEFAULT true`;
  await sql`
    CREATE TABLE IF NOT EXISTS "usuario_likes" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "id_emisor" uuid NOT NULL,
      "id_receptor" uuid NOT NULL,
      "fecha" timestamptz NOT NULL DEFAULT NOW(),
      CONSTRAINT "usuario_likes_par_unico" UNIQUE ("id_emisor", "id_receptor")
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS "usuario_likes_receptor_idx" ON "usuario_likes" ("id_receptor")`;
  await sql`CREATE INDEX IF NOT EXISTS "usuario_likes_emisor_idx" ON "usuario_likes" ("id_emisor")`;
  await sql`
    CREATE TABLE IF NOT EXISTS "usuario_notificaciones_meta" (
      "id_usuario" uuid PRIMARY KEY,
      "visto_hasta" timestamptz NOT NULL DEFAULT NOW()
    )
  `;
}

export function asegurarEsquemaConfig() {
  if (!promesaEsquema) {
    promesaEsquema = crearEsquema().catch((error) => {
      promesaEsquema = null;
      throw error;
    });
  }
  return promesaEsquema;
}

export default sql;
