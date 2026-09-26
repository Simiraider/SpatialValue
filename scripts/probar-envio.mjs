import fs from 'node:fs';

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

const connectionString =
  env.CONFIG_DATABASE_URL || env.SpatialValueStorage_DATABASE_URL;
if (!connectionString) {
  console.log('✖ No encontré la URL de la base en .env.local');
  process.exit(1);
}

const { neon } = await import('@neondatabase/serverless');
const sql = neon(connectionString);
const base = process.env.BASE_URL || 'http://localhost:4321';
const destinoForzado = process.env.EMAIL_DESTINO;

let usuario;
try {
  if (destinoForzado) {
    const filas = await sql`SELECT "id_usuario", "email" FROM "usuarios" WHERE "email" IS NOT NULL AND "email" <> '' LIMIT 1`;
    usuario = filas[0];
  } else {
    const filas = await sql`SELECT "id_usuario", "email" FROM "usuarios" WHERE "email" IS NOT NULL AND "email" <> '' AND ("email_verificado" IS NOT TRUE) LIMIT 1`;
    usuario = filas[0];
  }
} catch {}

if (!usuario) {
  console.log('✖ No encontré un usuario para probar.');
  console.log('  Opciones: todos los emails ya están verificados, o no hay usuarios con email.');
  console.log('  Forzá el envío a una casilla tuya con:  EMAIL_DESTINO=tucorreo@gmail.com node scripts/probar-envio.mjs');
  process.exit(1);
}

const destino = destinoForzado || usuario.email;
console.log(`▶ Solicitando código de verificación para ${destino} (vía ${base})…`);

const res = await fetch(`${base}/Apis/ActualizarConfigUsuario`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: `usuario_id=${usuario.id_usuario}` },
  body: JSON.stringify({
    accion: 'solicitar_verificacion',
    canal: 'email',
    destino,
  }),
});

const data = await res.json().catch(() => ({}));

if (data.ya_verificado) {
  console.log(`ℹ ${destino} ya está verificado para ese usuario, no se envía nada.`);
  console.log('  Para recibir un email real, forzá otra casilla con:  EMAIL_DESTINO=tucorreo@gmail.com node scripts/probar-envio.mjs');
} else if (res.ok && data.enviado) {
  console.log(`✔ EMAIL ENVIADO a ${destino}. Revisá la bandeja (y el spam).`);
} else if (res.ok && data.dev_code) {
  console.log(`⚠ El servidor respondió en MODO DEV (dev_code: ${data.dev_code}).`);
  console.log('  El proceso de astro arrancó antes de que SMTP_* estuviera en .env.local.');
  console.log('  Reinicialo y volvé a correr este script:  npx astro dev stop && npm run dev');
} else if (res.status === 429) {
  console.log(`⚠ Rate limit: ${data.error || 'esperá 2 minutos y probá de nuevo'}`);
} else {
  console.log(`✖ Falló (HTTP ${res.status}): ${data.error || JSON.stringify(data)}`);
}
