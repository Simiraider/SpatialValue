import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const ARCHIVO_FINAL = path.join(process.cwd(), 'dataset_propiedades.json');

const getProcessedIds = () => {
    if (!fs.existsSync(ARCHIVO_FINAL)) return new Set();
    try {
        return new Set(JSON.parse(fs.readFileSync(ARCHIVO_FINAL, 'utf-8')).map((p) => p.id_propiedad));
    } catch { return new Set(); }
};

const idsProcesados = getProcessedIds();
const nuevosResultados = [];

// Helper: espera un selector de una lista, devuelve el primero que aparezca
const waitForAny = async (page, selectors, timeout = 30000) => {
    return Promise.race(
        selectors.map(sel =>
            page.waitForSelector(sel, { timeout }).then(() => sel).catch(() => null)
        )
    ).then(result => result ?? null);
};

(async () => {
    console.log("🚀 Iniciando Scraper en entorno aislado...");

    // Perfil dedicado para el scraper (separado de tu Chrome normal)
    // Así no hay conflicto si tenés Chrome abierto
    const rutaDataScraper = path.join(process.cwd(), 'chrome_scraper_data');

    const context = await chromium.launchPersistentContext(rutaDataScraper, {
        headless: false,
        viewport: null,
        channel: 'chrome',
        ignoreDefaultArgs: true,
        args: [
            `--user-data-dir=${rutaDataScraper}`,  // perfil aislado, evita conflicto con Chrome abierto
            '--start-maximized',
            '--no-first-run',
            '--no-default-browser-check',
            '--no-service-autorun',
            '--password-store=basic',
        ]
    });

    // Stealth manual: inyectar en cada página antes de que cargue
    await context.addInitScript(() => {
        // Ocultar webdriver
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

        // Simular plugins reales de Chrome
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5].map((i) => ({
                name: `Plugin ${i}`, filename: `plugin${i}.dll`, description: '', length: 1
            }))
        });

        // Simular idiomas
        Object.defineProperty(navigator, 'languages', { get: () => ['es-AR', 'es', 'en-US', 'en'] });

        // Eliminar rastros de automatización en chrome object
        window.chrome = { runtime: {} };

        // Permisos: no revelar que es headless/bot
        const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
        if (originalQuery) {
            window.navigator.permissions.query = (params) =>
                params.name === 'notifications'
                    ? Promise.resolve({ state: Notification.permission })
                    : originalQuery(params);
        }
    });

    // Esperar que el contexto esté listo
    await new Promise(r => setTimeout(r, 2000));

    // Cerrar tabs extras si las hay, quedarse con una sola
    const pages = context.pages();
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    const page = pages[0] || await context.newPage();

    console.log('🌐 Navegando a ZonaProp...');
    await page.goto('https://www.zonaprop.com.ar/departamentos-alquiler-capital-federal.html', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
    });

    // --- PASO 1: Esperar que cargue el listado ---
    try {
        console.log('⏳ Esperando al listado. Si aparece Cloudflare, completalo manualmente...');

        // Selectores alternativos para el listado — ZonaProp cambia las clases dinámicamente
        const selectorListado = await waitForAny(page, [
            '[data-qa="posting-card"]',
            '[data-posting-id]',
            'article[data-id]',
            'div[class*="PostingCard"]',
            'div[class*="posting-card"]',
            'ol[class*="postings-container"] li',
            'section[class*="postings"] article',
        ], 300000);

        if (!selectorListado) throw new Error('No se encontró ningún card de propiedad en el listado.');
        console.log(`✅ Listado detectado con selector: ${selectorListado}`);

    } catch (e) {
        console.log('❌ El listado no cargó:', e.message);
        await context.close();
        return;
    }

    // --- PASO 2: Recolectar links ---
    // ZonaProp usa /propiedades/ en las URLs de detalle
    await page.waitForTimeout(2000); // pequeña pausa para que cargue todo el DOM

    const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        const hrefs = anchors
            .map(a => a.href)
            .filter(href =>
                href.includes('zonaprop.com.ar') &&
                href.match(/\/propiedades\/.*\.html/) &&
                !href.includes('#')
            );
        return [...new Set(hrefs)];
    });

    console.log(`🔎 Encontrados ${links.length} links de propiedades.`);

    if (links.length === 0) {
        // Debug: mostrar qué hay en la página
        const allLinks = await page.evaluate(() =>
            Array.from(document.querySelectorAll('a[href]'))
                .map(a => a.href)
                .filter(h => h.includes('zonaprop'))
                .slice(0, 20)
        );
        console.log('🔍 Links encontrados en la página (muestra):', allLinks);
        await context.close();
        return;
    }

    // --- PASO 3: Scrapear cada propiedad ---
    for (const link of links) {
        const idMatch = link.match(/-(\d+)\.html/);
        const id_propiedad = idMatch ? `zp-${idMatch[1]}` : null;

        if (!id_propiedad || idsProcesados.has(id_propiedad)) {
            console.log(`⏭ Saltando ${id_propiedad || link} (ya procesado o sin ID)`);
            continue;
        }

        console.log(`🏠 Procesando: ${id_propiedad} → ${link}`);

        try {
            await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Esperar precio (selector amplio)
            await waitForAny(page, [
                '[class*="price"]',
                '[class*="Price"]',
                '[data-qa="price"]',
                'span[class*="PriceValue"]',
                'div[class*="PriceValue"]',
            ], 15000);

            // --- Extraer precio ---
            const precioTexto = await page.evaluate(() => {
                const candidatos = [
                    ...document.querySelectorAll('[class*="price"], [class*="Price"], [data-qa="price"]')
                ];
                for (const el of candidatos) {
                    const txt = el.innerText || el.textContent || '';
                    if (txt.includes('USD') || txt.includes('$')) return txt.trim();
                }
                return '';
            });

            if (!precioTexto || !precioTexto.toUpperCase().includes('USD')) {
                console.log(`  ⚠ Sin precio en USD, saltando.`);
                continue;
            }

            // --- Extraer todo el texto de la página para análisis ---
            const textoCompleto = await page.evaluate(() => document.body.innerText.toLowerCase());

            // --- Título ---
            const tituloTexto = await page.evaluate(() => {
                const h1 = document.querySelector('h1, [class*="Title"], [data-qa="title"]');
                return h1 ? (h1.innerText || h1.textContent || '').trim() : '';
            });

            // --- Expensas ---
            const expensasTexto = await page.evaluate(() => {
                const candidatos = [
                    ...document.querySelectorAll('[class*="xpens"], [class*="Expens"], [data-qa="expenses"]')
                ];
                for (const el of candidatos) {
                    const txt = el.innerText || el.textContent || '';
                    if (txt.match(/\d/)) return txt.trim();
                }
                return '0';
            });

            // --- Features (superficie, dormitorios, baños) ---
            const features = await page.evaluate(() => {
                const items = [
                    ...document.querySelectorAll(
                        '[class*="feature"], [class*="Feature"], [class*="attribute"], [class*="Attribute"], [data-qa*="feature"]'
                    )
                ];
                return items.map(el => (el.innerText || el.textContent || '').toLowerCase().trim()).filter(Boolean);
            });

            // También intentar extraer desde el texto general con regex
            let superficie_total_m2 = null;
            let dormitorios = null;
            let banos = null;

            for (const feat of features) {
                const num = parseInt(feat.replace(/\D/g, ''), 10) || null;
                if ((feat.includes('tot') || feat.includes('m²') || feat.includes('m2')) && num) superficie_total_m2 = num;
                if ((feat.includes('dorm') || feat.includes('hab')) && num) dormitorios = num;
                if (feat.includes('baño') && num) banos = num;
            }

            // Fallback: buscar en el texto completo con regex
            if (!superficie_total_m2) {
                const m = textoCompleto.match(/(\d+)\s*m[²2]/);
                if (m) superficie_total_m2 = parseInt(m[1], 10);
            }
            if (!dormitorios) {
                const m = textoCompleto.match(/(\d+)\s*(?:dorm|dormitorio|habitac)/);
                if (m) dormitorios = parseInt(m[1], 10);
            }
            if (!banos) {
                const m = textoCompleto.match(/(\d+)\s*baño/);
                if (m) banos = parseInt(m[1], 10);
            }

            const check = (...words) => words.some(w => textoCompleto.includes(w));

            const barrios = ['palermo', 'recoleta', 'belgrano', 'caballito', 'saavedra', 'san telmo',
                'puerto madero', 'almagro', 'villa crespo', 'flores', 'floresta', 'villa urquiza',
                'colegiales', 'chacarita', 'parque patricios', 'barracas', 'liniers', 'boedo'];
            const barrioEncontrado = barrios.find(b =>
                textoCompleto.includes(b) || tituloTexto.toLowerCase().includes(b)
            );

            const propiedadData = {
                tipo_propiedad: textoCompleto.includes('casa') ? 'Casa' : 'Departamento',
                barrio_zona: barrioEncontrado
                    ? barrioEncontrado.charAt(0).toUpperCase() + barrioEncontrado.slice(1)
                    : 'Capital Federal',
                ambientes: dormitorios ? dormitorios + 1 : 1,
                dormitorios: dormitorios || 1,
                banos: banos || 1,
                superficie_total_m2: superficie_total_m2 || 45,
                superficie_cubierta_m2: superficie_total_m2 ? Math.floor(superficie_total_m2 * 0.9) : 40,
                estado: check('estrenar', 'a estrenar') ? 'Excellent' : 'Usado',
                anios_de_antiguedad: check('estrenar') ? 0 : 10,
                piso: parseInt(textoCompleto.match(/(?:piso|floor)\s*(\d+)/i)?.[1] || '1', 10),
                orientacion: 'No especificada',
                disposicion: textoCompleto.includes('frente') ? 'Frente'
                    : textoCompleto.includes('contrafrente') ? 'Contrafrente' : 'No especificada',
                cochera: check('cochera', 'garage', 'estacionamiento'),
                balcon: check('balcon', 'balcón'),
                terraza: check('terraza'),
                patio: check('patio'),
                pileta: check('pileta', 'piscina'),
                parrilla: check('parrilla'),
                seguridad_24hs: check('seguridad', 'vigilancia'),
                ascensor: check('ascensor', 'elevador'),
                expensas_ars: parseInt(expensasTexto.replace(/\D/g, ''), 10) || 0,
                baulera: check('baulera'),
                sum: check('sum', 'usos múltiples', 'salón'),
                seguridad_tipo: check('seguridad', 'vigilancia') ? 'Física' : 'Ninguno',
                camara: check('camara', 'cámara', 'cctv'),
                gym: check('gym', 'gimnasio'),
                lounge: check('lounge'),
                laundry: check('laundry', 'lavadero')
            };

            // --- Llamada a la IA local (opcional) ---
            let resultadoIA = {};
            try {
                const resIA = await fetch('http://127.0.0.1:8000/estimar-precio', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(propiedadData)
                });
                if (resIA.ok) resultadoIA = await resIA.json();
            } catch {
                // IA local no disponible, ignorar
            }

            const entrada = {
                id_propiedad,
                url: link,
                ...propiedadData,
                precio_real_usd: parseInt(precioTexto.replace(/\D/g, ''), 10),
                precio_estimado_ia_usd: resultadoIA.precio_estimado_usd || null,
                coordenadas_gps: resultadoIA.coordenadas || null,
                fecha_publicacion: new Date().toISOString().split('T')[0]
            };

            nuevosResultados.push(entrada);
            idsProcesados.add(id_propiedad);

            console.log(`  ✅ ${id_propiedad} | ${entrada.barrio_zona} | USD ${entrada.precio_real_usd} | ${entrada.superficie_total_m2}m²`);

            // Pausa anti-ban
            await page.waitForTimeout(2000 + Math.random() * 2000);

        } catch (e) {
            console.error(`❌ Error en ${id_propiedad}: ${e.message}`);
        }
    }

    // --- Guardar resultados ---
    const dataExistente = fs.existsSync(ARCHIVO_FINAL)
        ? JSON.parse(fs.readFileSync(ARCHIVO_FINAL, 'utf-8'))
        : [];

    const total = [...dataExistente, ...nuevosResultados];
    fs.writeFileSync(ARCHIVO_FINAL, JSON.stringify(total, null, 2));

    console.log(`\n🏁 Scraping completado.`);
    console.log(`   Nuevas propiedades: ${nuevosResultados.length}`);
    console.log(`   Total en dataset:   ${total.length}`);

    await context.close();
})();