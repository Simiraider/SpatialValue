import { loadEnv } from 'vite';
import { neon } from '@neondatabase/serverless';

const env = loadEnv('development', process.cwd(), '');
const sql = neon(env.SpatialValueStorage_DATABASE_URL);

async function main() {
  try {
    const users = await sql`SELECT id, nombre, email FROM usuarios`;
    console.log("Usuarios en BD:", users);
  } catch(e) {
    console.error("Error DB:", e.message);
  }
}
main();
