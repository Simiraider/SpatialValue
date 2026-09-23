import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const HOST = 'localhost';
const PUERTOS_CANDIDATOS = [process.env.E2E_PORT, '4321', '4322', '4599'].filter(Boolean);

async function estaArriba(base) {
  try {
    const res = await fetch(base);
    return res.ok;
  } catch {
    return false;
  }
}

const arg = (flag) => process.argv.includes(flag);
const errores = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  errores.push(msg);
};

async function esperarServidor(base) {
  for (let i = 0; i < 120; i++) {
    if (await estaArriba(base)) return true;
    await wait(500);
  }
  return false;
}

async function main() {
  let server = null;
  let baseEnUso = null;
  for (const puerto of PUERTOS_CANDIDATOS) {
    const base = `http://${HOST}:${puerto}`;
    if (await estaArriba(base)) {
      baseEnUso = base;
      ok(`Reutilizando servidor ya en ejecución en ${base}`);
      break;
    }
  }

  if (!baseEnUso) {
    const PORT = PUERTOS_CANDIDATOS[PUERTOS_CANDIDATOS.length - 1];
    baseEnUso = `http://${HOST}:${PORT}`;
    console.log(`▶ Levantando servidor aparte (astro dev, puerto ${PORT})…`);
    server = spawn('npx', ['astro', 'dev', '--host', HOST, '--port', String(PORT)], {
      cwd: ROOT,
      stdio: 'pipe',
      shell: true,
    });
    server.stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(`[srv] ${d}`));
    server.stderr.on('data', (d) => process.stderr.write(`[srv:err] ${d}`));
    if (!(await esperarServidor(baseEnUso))) {
      fail('El servidor no respondió en 60s');
      return;
    }
    ok(`Servidor arriba en ${baseEnUso}`);
  }
  const BASE = baseEnUso;

  try {
    const browser = await chromium.launch({ headless: !arg('--headed') });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (err) => fail(`Error JS en página: ${err.message}`));

    console.log('▶ Landing (/)');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    if ((await page.title()).includes('Spatial Value')) ok(`Título correcto: ${await page.title()}`);
    else fail(`Título inesperado: ${await page.title()}`);

    if (await page.locator('.navbar').count()) ok('Navbar visible');
    else fail('Falta la navbar');

    const iconos = await page.locator('.hero-step img').evaluateAll((imgs) =>
      imgs.map((img) => ({ src: img.getAttribute('src'), ok: img.naturalWidth > 0 }))
    );
    if (iconos.length === 3 && iconos.every((i) => i.ok)) ok(`3 íconos del hero cargan (${iconos.map((i) => i.src).join(', ')})`);
    else fail(`Íconos del hero rotos o incompletos: ${JSON.stringify(iconos)}`);

    console.log('▶ Flujo sin sesión');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.button-primary-large');
    await page.waitForURL('**/login', { timeout: 5000 }).then(
      () => ok('CTA "Comenzá a tasar" sin sesión → /login'),
      () => fail(`CTA no redirigió a /login (quedó en ${page.url()})`)
    );

    await page.goto(`${BASE}/tasacion`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/login', { timeout: 5000 }).then(
      () => ok('/tasacion sin sesión → redirige a /login'),
      () => fail(`/tasacion sin sesión quedó en ${page.url()}`)
    );

    console.log('▶ Flujo con sesión');
    await page.context().addCookies([
      { name: 'usuario_id', value: 'test-user', url: BASE },
    ]);
    await page.evaluate(() =>
      localStorage.setItem(
        'sv_user',
        JSON.stringify({ nombre: 'Tester E2E', id: 'test-user', avatar: '' })
      )
    );
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const perfil = page.locator('.nav-profile');
    if (await perfil.count()) {
      ok('Navbar muestra el chip de perfil logueado');
      const nombre = (await perfil.locator('.nav-profile-name').textContent())?.trim();
      if (nombre === 'Tester E2E') ok(`Nombre del perfil correcto: "${nombre}"`);
      else fail(`Nombre del perfil inesperado: "${nombre}"`);
    } else {
      fail('La navbar NO muestra el perfil con sesión activa');
    }

    await page.goto(`${BASE}/tasacion`, { waitUntil: 'domcontentloaded' });
    await wait(400);
    if (!page.url().includes('/login')) ok('/tasacion con sesión → se muestra el formulario');
    else fail('/tasacion con sesión igual redirigió a /login');

    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    if (page.url().includes('/dashboard')) ok('/dashboard accesible con sesión');
    else fail(`/dashboard redirigió a ${page.url()}`);

    await page.evaluate(() => document.cookie = 'usuario_id=; Max-Age=0; path=/');
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    if (page.url().includes('/login')) ok('/dashboard sin cookie → re-login');
    else fail(`/dashboard sin cookie quedó en ${page.url()}`);
    await page.evaluate(() => localStorage.clear());

    await browser.close();
  } finally {
    if (server) {
      server.kill();
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true });
    }
  }

  console.log(errores.length ? `\n✖ ${errores.length} verificación(es) fallaron` : '\n✔ Todo verificado sin errores');
  process.exit(errores.length ? 1 : 0);
}

main();
