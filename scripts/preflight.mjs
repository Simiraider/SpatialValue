import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const OK = '\x1b[32m✔\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';
const MAL = '\x1b[31m✖\x1b[0m';

const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    })
);

let fatal = false;

if (env.CONFIG_DATABASE_URL || env.SpatialValueStorage_DATABASE_URL) {
  console.log(`${OK} Variables de base de datos presentes`);
} else {
  console.log(`${MAL} Falta CONFIG_DATABASE_URL / SpatialValueStorage_DATABASE_URL en .env.local`);
  fatal = true;
}

if (!fatal) {
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(env.CONFIG_DATABASE_URL || env.SpatialValueStorage_DATABASE_URL);
    await sql`SELECT 1`;
    const tablas = await sql`
      SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('usuarios', 'verificaciones_contacto')
    `;
    if (tablas[0].n >= 2) {
      console.log(`${OK} Base de datos alcanzable y esquema presente`);
    } else {
      console.log(`${WARN} Base alcanzable pero faltan tablas (se crean en el primer arranque)`);
    }
  } catch (err) {
    console.log(`${MAL} No se pudo conectar a la base: ${err?.message || err}`);
    fatal = true;
  }
}

const comandoPython = process.platform === 'win32' ? 'python' : 'python3';
const prueba = spawnSync(comandoPython, ['-c', 'import sklearn, scipy, pandas, fastapi, psycopg2'], {
  timeout: 20000,
  encoding: 'utf8',
});
if (prueba.status === 0) {
  console.log(`${OK} Dependencias de Python listas (sklearn, fastapi)`);
} else {
  console.log(`${WARN} La API de IA va a fallar: falta dependencia de Python.`);
  console.log(`   Detalle: ${(prueba.stderr || prueba.stdout || 'import error').trim().split('\n').pop()}`);
  console.log('   Instalalas con:  pip install -r src/pages/Apis/requirements.txt');
}

if (fatal) {
  console.log(`\n${MAL} Preflight falló: no se inicia el entorno de desarrollo.`);
  process.exit(1);
}
console.log('');
