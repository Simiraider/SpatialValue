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
export default sql;
