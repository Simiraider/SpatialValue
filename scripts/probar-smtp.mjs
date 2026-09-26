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

const host = env.SMTP_HOST;
const port = Number(env.SMTP_PORT || 587);
const user = env.SMTP_USER;
const pass = env.SMTP_PASS;

if (!host || !user || !pass) {
  console.log('✖ Faltan variables: SMTP_HOST, SMTP_USER o SMTP_PASS en .env.local');
  process.exit(1);
}

console.log(`▶ Probando handshake con ${host}:${port} como ${user}…`);

const nodemailer = (await import('nodemailer')).default;
const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },
});

try {
  await transporter.verify();
  console.log('✔ Credenciales SMTP válidas: Gmail aceptó la conexión y la autenticación.');
} catch (err) {
  console.log(`✖ Falló la autenticación SMTP: ${err?.message || err}`);
  if (String(err?.message).includes('Invalid login')) {
    console.log('  Pista: SMTP_PASS debe ser la contraseña de aplicación de 16 caracteres (sin espacios), no la contraseña normal de Gmail.');
  }
  process.exit(1);
}
