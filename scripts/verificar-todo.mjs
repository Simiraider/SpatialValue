import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const MODO_DEV = process.argv.includes('--dev');
const OK = '\x1b[32m✔\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';
const MAL = '\x1b[31m✖\x1b[0m';

const PUERTOS = ['4321', '4322', '4599'];
const PUERTO_EFIMERO = '4599';
const IA_URL = process.env.IA_URL || 'http://127.0.0.1:8000';
const USUARIO_QA = { usuario: 'QA Bot SP', email: 'qa-bot@spatialvalue.test', contraseña: 'QaBot-1234!' };

let env = {};
try {
  env = Object.fromEntries(
    fs
      .readFileSync('.env.local', 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
      })
  );
} catch (err) {
  console.log(`⚠ No se pudo leer .env.local: ${err?.message || err}`);
}

const lineas = [];
const registrar = (seccion, estado, texto) => lineas.push({ seccion, estado, texto });

async function alcance(url, ms = 800) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return res.ok;
  } catch {
    return false;
  }
}

function matarProceso(hijo) {
  if (!hijo) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(hijo.pid), '/T', '/F'], { shell: true, timeout: 15000 });
  } else {
    hijo.kill('SIGTERM');
  }
}

function matarPuerto(puerto) {
  if (process.platform !== 'win32') return;
  const res = spawnSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 10000, shell: true });
  const pids = new Set();
  for (const linea of (res.stdout || '').split(/\r?\n/)) {
    if (linea.includes(`:${puerto} `) && linea.includes('LISTENING')) {
      const pid = linea.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    }
  }
  for (const pid of pids) {
    spawnSync('taskkill', ['/pid', pid, '/T', '/F'], { shell: true, timeout: 10000 });
  }
}

async function iaViva() {
  try {
    const res = await fetch(`${IA_URL}/`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    return await res.json().catch(() => ({}));
  } catch {
    return null;
  }
}

function pidVivo(pid) {
  if (!pid) return false;
  const res = spawnSync('tasklist', ['/FI', `PID eq ${pid}`], { encoding: 'utf8', timeout: 10000, shell: process.platform === 'win32' });
  return (res.stdout || '').includes(String(pid));
}

function leerDaemonAstro() {
  try {
    return JSON.parse(fs.readFileSync('.astro/dev.json', 'utf8'));
  } catch {
    return null;
  }
}

async function limpiarDaemonAstro() {
  const estado = leerDaemonAstro();
  if (!estado) return;
  const puerto = String(estado.port || '');
  const vivo = pidVivo(estado.pid);
  if (vivo && puerto && (await alcance(`http://localhost:${puerto}/`, 1500))) return;
  if (vivo) {
    console.log(`▶ Daemon de astro trabado (pid ${estado.pid}, puerto ${puerto} sin responder): reiniciándolo…`);
    spawnSync('taskkill', ['/pid', String(estado.pid), '/T', '/F'], { shell: true, timeout: 15000 });
  }
  fs.rmSync('.astro/dev.json', { force: true });
}

async function elegirServidor() {
  const objetivo = MODO_DEV ? 75000 : 2500;
  const inicio = Date.now();
  while (Date.now() - inicio < objetivo) {
    for (const p of PUERTOS) {
      if (await alcance(`http://localhost:${p}/`)) return { base: `http://localhost:${p}`, servidor: null };
    }
    if (MODO_DEV) await new Promise((r) => setTimeout(r, 1000));
  }
  if (MODO_DEV) return { base: null, servidor: null };

  console.log(`▶ Sin servidor activo: levantando uno efímero en :${PUERTO_EFIMERO}…`);
  const levantar = () =>
    spawn('npx', ['astro', 'dev', '--host', 'localhost', '--port', PUERTO_EFIMERO], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
  const esperar = async (segundos) => {
    const inicio = Date.now();
    while (Date.now() - inicio < segundos * 1000) {
      if (await alcance(`http://localhost:${PUERTO_EFIMERO}/`)) return true;
      await new Promise((r) => setTimeout(r, 800));
    }
    return false;
  };

  let hijo = levantar();
  if (await esperar(60)) return { base: `http://localhost:${PUERTO_EFIMERO}`, servidor: hijo };

  matarProceso(hijo);
  await limpiarDaemonAstro();
  hijo = levantar();
  if (await esperar(60)) return { base: `http://localhost:${PUERTO_EFIMERO}`, servidor: hijo };
  matarProceso(hijo);
  return { base: null, servidor: null };
}

async function obtenerSesion(base) {
  let login = null;
  try {
    login = await fetch(`${base}/Apis/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: USUARIO_QA.email, contraseña: USUARIO_QA.contraseña }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {}
  if (login?.ok) {
    const cookie = login.headers.getSetCookie().find((c) => c.startsWith('usuario_id='));
    if (cookie) return { id: cookie.split(';')[0].split('=')[1], via: 'login' };
  }

  let registro = null;
  try {
    registro = await fetch(`${base}/Apis/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(USUARIO_QA),
      signal: AbortSignal.timeout(10000),
    });
  } catch {}
  if (registro?.status === 201) {
    const cookie = registro.headers.getSetCookie().find((c) => c.startsWith('usuario_id='));
    if (cookie) return { id: cookie.split(';')[0].split('=')[1], via: 'registro' };
  }

  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(env.CONFIG_DATABASE_URL || env.SpatialValueStorage_DATABASE_URL);
    const filas = await sql`SELECT "id_usuario" FROM "usuarios" WHERE "email" = ${USUARIO_QA.email} LIMIT 1`;
    if (filas[0]) return { id: filas[0].id_usuario, via: 'db' };
  } catch {}
  return null;
}

async function capaBaseDeDatos() {
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(env.CONFIG_DATABASE_URL || env.SpatialValueStorage_DATABASE_URL);
    await sql`SELECT 1`;
    const tablas = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('usuarios', 'verificaciones_contacto', 'usuario_likes')
    `;
    if (tablas.length >= 3) {
      registrar('Base de datos', 'ok', `conectada, ${tablas.length} tablas clave presentes`);
    } else {
      registrar('Base de datos', 'mal', `faltan tablas (${tablas.map((t) => t.table_name).join(', ')})`);
    }
  } catch (err) {
    registrar('Base de datos', 'mal', `error: ${err?.message || err}`);
  }
}

async function capaApis(base) {
  const sesion = await obtenerSesion(base);
  if (!sesion) {
    registrar('APIs backend', 'mal', 'no se pudo crear sesión de prueba (login/registro/DB)');
    return;
  }
  const cookie = `usuario_id=${sesion.id}`;
  let okCount = 0;
  const total = 5;

  const configRes = await fetch(`${base}/Apis/ObtenerConfigUsuario`, { headers: { Cookie: cookie } }).catch(() => null);
  const configData = await configRes?.json().catch(() => null);
  if (configRes?.ok && configData?.config) {
    okCount++;
    registrar('APIs backend', 'ok', `ObtenerConfigUsuario (${sesion.via})`);
  } else {
    registrar('APIs backend', 'mal', `ObtenerConfigUsuario falló (HTTP ${configRes?.status})`);
  }

  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(env.CONFIG_DATABASE_URL || env.SpatialValueStorage_DATABASE_URL);
    await sql`UPDATE "usuarios" SET "email_verificado" = true WHERE "id_usuario" = ${sesion.id}`;
  } catch {}

  const monedaOriginal = configData?.config?.moneda === 'ARS' ? 'ARS' : 'USD';
  const monedaPrueba = monedaOriginal === 'ARS' ? 'USD' : 'ARS';
  const updateRes = await fetch(`${base}/Apis/ActualizarConfigUsuario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ config: { ...(configData?.config ?? {}), moneda: monedaPrueba } }),
  }).catch(() => null);
  const updateData = await updateRes?.json().catch(() => null);
  if (updateRes?.ok && updateData?.config?.moneda === monedaPrueba && 'email_verificado' in (updateData?.config ?? {})) {
    okCount++;
    registrar('APIs backend', 'ok', `ActualizarConfigUsuario (moneda → ${monedaPrueba})`);
  } else {
    registrar('APIs backend', 'mal', `ActualizarConfigUsuario falló (HTTP ${updateRes?.status})`);
  }
  await fetch(`${base}/Apis/ActualizarConfigUsuario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ config: { ...(configData?.config ?? {}), moneda: monedaOriginal } }),
  }).catch(() => {});

  const verifRes = await fetch(`${base}/Apis/ActualizarConfigUsuario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ accion: 'solicitar_verificacion', canal: 'email', destino: 'destino-distinto@test.invalid' }),
  }).catch(() => null);
  if (verifRes?.status === 409 || verifRes?.status === 400 || verifRes?.status === 429) {
    okCount++;
    registrar('APIs backend', 'ok', 'guard de verificación activo (409 destino ≠ guardado)');
  } else {
    registrar('APIs backend', 'mal', `guard de verificación no responde como se espera (HTTP ${verifRes?.status})`);
  }

  const notifRes = await fetch(`${base}/Apis/ObtenerNotificaciones`, { headers: { Cookie: cookie } }).catch(() => null);
  if (notifRes?.ok) {
    okCount++;
    registrar('APIs backend', 'ok', 'ObtenerNotificaciones');
  } else {
    registrar('APIs backend', 'mal', `ObtenerNotificaciones falló (HTTP ${notifRes?.status})`);
  }

  const propRes = await fetch(`${base}/Apis/ObtenerDatosPropiedades`, { headers: { Cookie: cookie } }).catch(() => null);
  if (propRes?.ok) {
    okCount++;
    registrar('APIs backend', 'ok', 'ObtenerDatosPropiedades');
  } else {
    registrar('APIs backend', 'mal', `ObtenerDatosPropiedades falló (HTTP ${propRes?.status})`);
  }

  if (okCount < total) registrar('APIs backend', 'mal', `${okCount}/${total} checks pasaron`);
}

async function capaIA() {
  const inicio = Date.now();
  const limite = MODO_DEV ? 45000 : 3000;
  let salud = null;
  while (Date.now() - inicio < limite) {
    salud = await iaViva();
    if (salud) break;
    await new Promise((r) => setTimeout(r, 1200));
  }

  let efimera = null;
  if (!salud && !MODO_DEV) {
    console.log(`▶ IA no activa: levantando instancia efímera en :8000…`);
    efimera = spawn(process.platform === 'win32' ? 'python' : 'python3', ['src/pages/Apis/api_ia.py'], { stdio: 'ignore' });
    const inicioSpawn = Date.now();
    while (Date.now() - inicioSpawn < 60000) {
      salud = await iaViva();
      if (salud) break;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  if (!salud) {
    matarProceso(efimera);
    registrar('IA', 'mal', `no responde en ${IA_URL} — revisá la terminal de python`);
    return;
  }

  try {
    const estimacion = await fetch(`${IA_URL}/estimar-precio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tipo_propiedad: 'Departamento',
      barrio_zona: 'Palermo',
      ambientes: 3,
      dormitorios: 2,
      banos: 1,
      superficie_total_m2: 70,
      superficie_cubierta_m2: 60,
      estado: 'A estrenar',
      anios_de_antiguedad: 5,
      piso: 3,
      orientacion: null,
      disposicion: null,
      cochera: false,
      balcon: true,
      terraza: false,
      patio: false,
      pileta: false,
      parrilla: true,
      seguridad_24hs: false,
      ascensor: true,
      expensas_ars: 50000,
      baulera: false,
      sum: false,
      seguridad_tipo: 'Ninguno',
      camara: false,
      gym: false,
      lounge: false,
      laundry: false,
      latitud: null,
      longitud: null,
    }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
    const datos = await estimacion?.json().catch(() => null);

    if (estimacion?.ok && typeof datos?.precio_estimado_usd === 'number') {
      const modelo = salud?.modelo === 'listo' ? 'modelo entrenado' : 'sin modelo (fase datos)';
      registrar('IA', 'ok', `estimó USD ${datos.precio_estimado_usd.toFixed(2)} (${modelo})`);
    } else {
      registrar('IA', 'mal', `/estimar-precio falló (HTTP ${estimacion?.status}): ${JSON.stringify(datos)?.slice(0, 120)}`);
    }
  } catch (err) {
    registrar('IA', 'mal', `error inesperado: ${err?.message || err}`);
  } finally {
    matarProceso(efimera);
    if (efimera) matarPuerto(new URL(IA_URL).port || '8000');
  }
}

function capaE2E(base) {
  const puerto = new URL(base).port || '4321';
  const res = spawnSync(process.execPath, ['scripts/verificar-e2e.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, E2E_PORT: puerto },
    timeout: 120000,
  });
  if (res.status === 0) {
    registrar('Frontend E2E', 'ok', '11 verificaciones de Playwright');
  } else {
    registrar('Frontend E2E', 'mal', `falló con código ${res.status ?? 'timeout'}`);
  }
}

function capaSMTP() {
  if (!env.SMTP_PASS) {
    registrar('SMTP', 'aviso', 'sin configurar (modo dev: código en pantalla)');
    return;
  }
  const res = spawnSync(process.execPath, ['scripts/probar-smtp.mjs'], { stdio: 'inherit', timeout: 30000 });
  if (res.status === 0) {
    registrar('SMTP', 'ok', 'credenciales válidas');
  } else {
    registrar('SMTP', 'mal', 'handshake falló');
  }
}

async function capaServidor() {
  const { base, servidor } = await elegirServidor();
  if (!base) {
    registrar('Servidor', 'mal', MODO_DEV ? 'astro dev no levantó en 75s' : 'no se pudo levantar servidor de prueba');
    return { base: null, efimero: servidor };
  }
  registrar('Servidor', 'ok', base);
  return { base, efimero: servidor };
}

await limpiarDaemonAstro();
const { base, efimero } = await capaServidor();
if (base) {
  await capaBaseDeDatos();
  await capaApis(base);
  await capaIA();
  capaE2E(base);
  capaSMTP();
}
matarProceso(efimero);
if (base) matarPuerto(PUERTO_EFIMERO);

console.log('\n══════════ Resumen de verificación ══════════');
let malos = 0;
for (const { seccion, estado, texto } of lineas) {
  const icono = estado === 'ok' ? OK : estado === 'aviso' ? WARN : MAL;
  if (estado === 'mal') malos++;
  console.log(`  ${icono} ${seccion.padEnd(15)} ${texto}`);
}
if (!lineas.length) console.log(`  ${MAL} sin resultados (servidor no disponible)`);

if (MODO_DEV) {
  console.log(malos ? `\n${MAL} ${malos} capa(s) con problemas (el dev sigue corriendo igual)\n` : `\n${OK} Todo el sistema verificado — el dev sigue corriendo\n`);
  process.exit(0);
}
console.log(malos ? `\n${MAL} ${malos} capa(s) con problemas\n` : `\n${OK} Todo el sistema verificado sin errores\n`);
process.exit(malos ? 1 : 0);
