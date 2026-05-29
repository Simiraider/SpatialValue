import { neon } from '@neondatabase/serverless';
import { loadEnv } from 'vite';

const env = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');
const connectionString = env.SpatialValueStorage_DATABASE_URL || process.env.SpatialValueStorage_DATABASE_URL;

if (!connectionString) {
  throw new Error("❌ DATABASE_URL no está definida. Revisá el archivo .env.local");
}
console.log("Intentando conectar a:", connectionString ? "URL detectada (oculta por seguridad)" : "NADA");
const sql = neon(connectionString);
export default sql;