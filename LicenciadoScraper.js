import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const ARCHIVO_FINAL = path.join(process.cwd(), 'dataset_propiedades.json');

const getProcessedIds = () => {
    if (!fs.existsSync(ARCHIVO_FINAL)) return new Set();
    try {
        return new Set(JSON.parse(fs.readFileSync(ARCHIVO_FINAL, 'utf-8')).map(p => p.id_propiedad));
    } catch { return new Set(); }
};

const idsProcesados = getProcessedIds();
const nuevosResultados = [];

const waitForAny = async (page, selectors, timeout = 30000) => {
    return Promise.race(
        selectors.map(sel =>
            page.waitForSelector(sel, { timeout }).then(() => sel).catch(() => null)
        )
    ).then(r => r ?? null);
};

// Extrae solo el primer número USD de un texto, ignorando expensas
// Ej: "Alquiler USD 1.800" → 1800
const parsearPrecioUSD = (texto) => {
    const match = texto.match(/USD\s*[\$]?\s*([\d.,]+)/i);
    if (!match) return null;
    // Eliminar puntos de miles y comas decimales
    const limpio = match[1].replace(/\./g, '').replace(',', '.');
    const valor = parseFloat(limpio);
    // Sanity check: alquileres en CABA van de ~300 a ~20000 USD
    return (valor >= 100 && valor <= 50000) ? Math.round(valor) : null;
};

(async () => {
    console.log("🚀 Conectando a Chrome...");

    let browser;
    try {
        browser = await chromium.connectOverCDP('http://localhost:9222');
    } catch {
        console.error('❌ No se pudo conectar. Abrí Chrome con:\n   & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\\chrome-debug"');
        process.exit(1);
    }

    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();

    await page.goto('https://www.zonaprop.com.ar/departamentos-alquiler-capital-federal.html', {
        waitUntil: 'domcontentloaded', timeout: 60000
    });

    console.log('⏳ Esperando listado...');
    const selectorListado = await waitForAny(page, [
        '[data-qa="posting-card"]',
        '[data-posting-id]',
        'div[class*="posting-card"]',
        'ol[class*="postings"] li',
        'article',
    ], 300000);

    if (!selectorListado) {
        console.log('❌ Listado no encontrado.');
        await browser.close();
        return;
    }

    await page.waitForTimeout(2000);

    const links = await page.evaluate(() =>
        [...new Set(
            Array.from(document.querySelectorAll('a[href]'))
                .map(a => a.href)
                .filter(h => h.includes('zonaprop.com.ar') && h.match(/\/propiedades\/.*\.html/) && !h.includes('#'))
        )]
    );

    console.log(`🔎 ${links.length} propiedades encontradas.`);

    for (const link of links) {
        const idMatch = link.match(/-(\d+)\.html/);
        const id_propiedad = idMatch ? `zp-${idMatch[1]}` : null;
        if (!id_propiedad || idsProcesados.has(id_propiedad)) continue;

        const detailPage = await context.newPage();
        try {
            await detailPage.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await waitForAny(detailPage, ['[class*="price"]', '[class*="Price"]', '[data-qa="price"]'], 15000);

            // ── Precio ──────────────────────────────────────────────────────
            // Buscar específicamente el elemento de precio del alquiler, no expensas
            const precioUSD = await detailPage.evaluate(() => {
                // Intentar data-qa primero
                const byQa = document.querySelector('[data-qa="price"]');
                if (byQa) return byQa.innerText.trim();

                // Buscar el h2/h3/span que contenga "USD" pero NO esté dentro de expensas
                const todos = [...document.querySelectorAll('[class*="Price"],[class*="price"]')];
                for (const el of todos) {
                    const padre = el.closest('[class*="xpens"],[class*="Expens"]');
                    if (padre) continue; // saltar si es expensas
                    const txt = el.innerText || el.textContent || '';
                    if (txt.includes('USD')) return txt.trim();
                }
                // Fallback: primer elemento con USD en el body
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                let node;
                while ((node = walker.nextNode())) {
                    if (node.textContent.includes('USD')) {
                        return node.parentElement.innerText?.trim() || '';
                    }
                }
                return '';
            });

            const precio_real_usd = parsearPrecioUSD(precioUSD);
            if (!precio_real_usd) {
                console.log(`  ⚠ Sin precio USD válido (texto: "${precioUSD}"), saltando.`);
                continue;
            }

            // ── Expensas ─────────────────────────────────────────────────────
            const expensas_ars = await detailPage.evaluate(() => {
                const candidatos = [...document.querySelectorAll('[class*="xpens"],[class*="Expens"],[data-qa="expenses"]')];
                for (const el of candidatos) {
                    const txt = el.innerText || el.textContent || '';
                    const m = txt.match(/[\d.,]+/);
                    if (m) return parseInt(m[0].replace(/\./g, '').replace(',', ''), 10);
                }
                return 0;
            });

            // ── Texto completo y título ───────────────────────────────────────
            const textoCompleto = await detailPage.evaluate(() => document.body.innerText.toLowerCase());
            const tituloTexto = await detailPage.evaluate(() => {
                const el = document.querySelector('h1,[data-qa="title"],[class*="TitleContainer"]');
                return el ? (el.innerText || el.textContent || '').trim().toLowerCase() : '';
            });

            // ── Superficie ───────────────────────────────────────────────────
            // ZonaProp muestra "60m² · 1 ambiente" en el breadcrumb/header
            let superficie_total_m2 = await detailPage.evaluate(() => {
                // Buscar en el resumen superior "Xm²"
                const resumen = document.querySelector('[class*="MainFeatures"],[class*="main-features"],[data-qa="main-features"]');
                if (resumen) {
                    const m = (resumen.innerText || '').match(/(\d+)\s*m²/i);
                    if (m) return parseInt(m[1], 10);
                }
                // Buscar en features individuales
                const items = [...document.querySelectorAll('[class*="feature"],[class*="Feature"]')];
                for (const el of items) {
                    const txt = el.innerText || '';
                    if (txt.match(/m²|m2/i)) {
                        const n = txt.match(/(\d+)/);
                        if (n) return parseInt(n[1], 10);
                    }
                }
                return null;
            });
            // Fallback regex en texto completo
            if (!superficie_total_m2) {
                const m = textoCompleto.match(/(\d+)\s*m[²2]/);
                if (m) superficie_total_m2 = parseInt(m[1], 10);
            }
            // Sanity check superficie (evitar "1 ambiente" confundido con m²)
            if (superficie_total_m2 && superficie_total_m2 < 15) superficie_total_m2 = null;

            // ── Dormitorios y baños ───────────────────────────────────────────
            let dormitorios = await detailPage.evaluate(() => {
                const items = [...document.querySelectorAll('[class*="feature"],[class*="Feature"]')];
                for (const el of items) {
                    const txt = (el.innerText || '').toLowerCase();
                    if (txt.match(/dorm|hab/)) {
                        const n = txt.match(/(\d+)/);
                        if (n) return parseInt(n[1], 10);
                    }
                }
                return null;
            });
            if (!dormitorios) {
                const m = textoCompleto.match(/(\d+)\s*(?:dormitorio|dorm|habitaci)/);
                if (m) dormitorios = parseInt(m[1], 10);
            }

            let banos = await detailPage.evaluate(() => {
                const items = [...document.querySelectorAll('[class*="feature"],[class*="Feature"]')];
                for (const el of items) {
                    const txt = (el.innerText || '').toLowerCase();
                    if (txt.includes('baño')) {
                        const n = txt.match(/(\d+)/);
                        if (n) return parseInt(n[1], 10);
                    }
                }
                return null;
            });
            if (!banos) {
                const m = textoCompleto.match(/(\d+)\s*baño/);
                if (m) banos = parseInt(m[1], 10);
            }

            // ── Ambientes ─────────────────────────────────────────────────────
            let ambientes = await detailPage.evaluate(() => {
                const items = [...document.querySelectorAll('[class*="feature"],[class*="Feature"]')];
                for (const el of items) {
                    const txt = (el.innerText || '').toLowerCase();
                    if (txt.includes('ambiente')) {
                        const n = txt.match(/(\d+)/);
                        if (n) return parseInt(n[1], 10);
                    }
                }
                return null;
            });
            if (!ambientes) {
                const m = textoCompleto.match(/(\d+)\s*ambiente/);
                if (m) ambientes = parseInt(m[1], 10);
            }
            if (!ambientes) ambientes = dormitorios ? dormitorios + 1 : 1;

            const check = (...words) => words.some(w => textoCompleto.includes(w));
            const barrios = ['palermo', 'recoleta', 'belgrano', 'caballito', 'saavedra', 'san telmo',
                'puerto madero', 'almagro', 'villa crespo', 'flores', 'villa urquiza', 'colegiales',
                'chacarita', 'parque patricios', 'barracas', 'boedo', 'liniers', 'núñez', 'nunez',
                'villa del parque', 'paternal', 'agronomia', 'devoto', 'versalles'];
            const barrioEncontrado = barrios.find(b => textoCompleto.includes(b) || tituloTexto.includes(b));

            const propiedadData = {
                tipo_propiedad: textoCompleto.includes('casa') ? 'Casa' : 'Departamento',
                barrio_zona: barrioEncontrado
                    ? barrioEncontrado.charAt(0).toUpperCase() + barrioEncontrado.slice(1)
                    : 'Capital Federal',
                ambientes,
                dormitorios: dormitorios || 1,
                banos: banos || 1,
                superficie_total_m2: superficie_total_m2 || null,
                superficie_cubierta_m2: superficie_total_m2 ? Math.floor(superficie_total_m2 * 0.9) : null,
                estado: check('a estrenar', 'estrenar') ? 'A estrenar' : 'Usado',
                anios_de_antiguedad: check('estrenar') ? 0 : null,
                piso: parseInt(textoCompleto.match(/piso\s*(\d+)/i)?.[1] || '0', 10) || null,
                orientacion: 'No especificada',
                disposicion: check('contrafrente') ? 'Contrafrente' : check('al frente', 'a la calle') ? 'Frente' : 'No especificada',
                cochera: check('cochera', 'garage', 'estacionamiento'),
                balcon: check('balcon', 'balcón'),
                terraza: check('terraza'),
                patio: check('patio'),
                pileta: check('pileta', 'piscina'),
                parrilla: check('parrilla'),
                seguridad_24hs: check('seguridad 24', 'vigilancia 24'),
                ascensor: check('ascensor', 'elevador'),
                expensas_ars,
                baulera: check('baulera'),
                sum: check('sum', 'salón de usos'),
                seguridad_tipo: check('seguridad', 'vigilancia') ? 'Física' : 'Ninguno',
                camara: check('camara', 'cámara', 'cctv'),
                gym: check('gym', 'gimnasio'),
                lounge: check('lounge'),
                laundry: check('laundry', 'lavadero')
            };

            let resultadoIA = {};
            try {
                const resIA = await fetch('http://127.0.0.1:8000/estimar-precio', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(propiedadData)
                });
                if (resIA.ok) resultadoIA = await resIA.json();
            } catch {}

            nuevosResultados.push({
                id_propiedad, url: link, ...propiedadData,
                precio_real_usd,
                precio_estimado_ia_usd: resultadoIA.precio_estimado_usd || null,
                coordenadas_gps: resultadoIA.coordenadas || null,
                fecha_publicacion: new Date().toISOString().split('T')[0]
            });
            idsProcesados.add(id_propiedad);

            console.log(`✅ ${id_propiedad} | ${propiedadData.barrio_zona} | USD ${precio_real_usd} | ${superficie_total_m2 ?? '?'}m² | ${ambientes} amb`);
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));

        } catch (e) {
            console.error(`❌ ${id_propiedad}: ${e.message}`);
        } finally {
            await detailPage.close().catch(() => {});
        }
    }

    const dataExistente = fs.existsSync(ARCHIVO_FINAL)
        ? JSON.parse(fs.readFileSync(ARCHIVO_FINAL, 'utf-8')) : [];
    const total = [...dataExistente, ...nuevosResultados];
    fs.writeFileSync(ARCHIVO_FINAL, JSON.stringify(total, null, 2));
    console.log(`\n🏁 Listo. Nuevas: ${nuevosResultados.length} | Total: ${total.length}`);
    await browser.close();
})();