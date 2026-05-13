import { neon } from '@neondatabase/serverless';

const connectionString = import.meta.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ ERROR: DATABASE_URL no encontrada. Verificá tu archivo .env.local");
}

const sql = neon(connectionString);

export default sql;