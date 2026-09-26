import { neon } from '@neondatabase/serverless';

const connectionString = import.meta.env.SpatialValueStorage_DATABASE_URL || process.env.SpatialValueStorage_DATABASE_URL;

if (!connectionString) {
  throw new Error("❌ DATABASE_URL no está definida. Revisá el archivo .env.local");
}
const sql = neon(connectionString);
export default sql;