import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

chromium.use(stealthPlugin());

const ARCHIVO_FINAL = path.join(process.cwd(), 'dataset_propiedades.json');

const getProcessedIds = () => {
    if (!fs.existsSync(ARCHIVO_FINAL)) return new Set();
    try {
        return new Set(JSON.parse(fs.readFileSync(ARCHIVO_FINAL, 'utf-8')).map(p => p.id_propiedad));
    } catch { return new Set(); }
};

const idsProcesados = getProcessedIds();
const nuevosResultados = [];

(async () => {
    console.log('🚀 Iniciando Scraper con perfil real de Chrome...');

    // Usamos el perfil real de Chrome — ya tiene cookies, historial, todo
    const browser = await chromium.launchPersistentContext(
        'C:\\Users\\49516747\\AppData\\Local\\Google\\Chrome\\User Data',
        {
            channel: 'chrome',
            headless: false,
            viewport: null,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--start-maximized',
                '--no-sandbox',
                '--disable-infobars',
                '--profile-directory=Default',
            ],
        }
    );

    const page = await browser.newPage();

    console.log('⏳ Navegando a Zonaprop...');
    await page.goto(
        'https://www.zonaprop.com.ar/departamentos-alquiler-capital-federal.html',
        { waitUntil: 'domcontentloaded', timeout: 60_000 }
    );

    console.log('👀 Esperando que cargue el listado (tenés 3 minutos para resolver captcha si aparece)...');

    // Race: o carga el listado, o timeout de 3 minutos
    const selectorListado = '[class*="PostingCard"], [data-qa="posting-card"]';
    let listadoCargado = false;

    try {
        await page.waitForSelector(selectorListado, { timeout: 180_000 });
        listadoCargado = true;
        console.log('🎉 Listado cargado correctamente.');
    } catch {
        console.error('❌ El listado no cargó en 3 minutos. Cerrando.');
        await browser.close();
        process.exit(1);
    }

    // Delay humano antes de empezar a scrapear
    await page.waitForTimeout(1500 + Math.random() * 1500);

    // Capturar todos los links únicos
    const links = await page.$$eval('a[href*="/propiedades/"]', els =>
        [...new Set(els.map(a => a.href))].filter(href => href.includes('.html'))
    );
    console.log(`🔎 ${links.length} propiedades encontradas.`);

    for (const link of links) {
        const idMatch = link.match(/-(\d+)\.html/);
        const id_propiedad = idMatch ? `zp-${idMatch[1]}` : null;

        if (!id_propiedad || idsProcesados.has(id_propiedad)) {
            console.log(`⏩ Saltando: ${id_propiedad}`);
            continue;
        }

        console.log(`⏳ Procesando: ${id_propiedad}`);

        try {
            await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30_000 });

            try {
                await page.waitForSelector(
                    '[class*="PriceValue"], [class*="DescriptionBlock"]',
                    { timeout: 15_000 }
                );
            } catch { /* algunos listings no tienen precio visible */ }

            const precioTexto = await page
                .locator('[class*="PriceValue"], [class*="price"]')
                .first()
                .textContent()
                .catch(() => '');

            if (!precioTexto || !precioTexto.includes('USD')) {
                console.log('⏩ Omitido: no está en USD.');
                continue;
            }

            const tituloTexto = await page
                .locator('[class*="Title"]')
                .first()
                .textContent()
                .catch(() => '');

            const cuerpoTexto = (
                await page
                    .locator('[class*="DescriptionBlock"]')
                    .textContent()
                    .catch(() => '')
            ).toLowerCase();

            const expensasTexto = await page
                .locator('[class*="ExpensesValue"], [class*="expensas"]')
                .first()
                .textContent()
                .catch(() => '0');

            let superficie_total_m2 = null;
            let dormitorios = null;
            let banos = null;

            const features = await page
                .locator('[class*="IconFeatures"]')
                .allTextContents()
                .catch(() => []);

            for (const feat of features) {
                const txt = feat.toLowerCase();
                const num = parseInt(txt.replace(/\D/g, ''), 10) || null;
                if (txt.includes('tot') || txt.includes('m²')) superficie_total_m2 = num;
                if (txt.includes('dorm') || txt.includes('hab')) dormitorios = num;
                if (txt.includes('baño')) banos = num;
            }

            const check = (...words) => words.some(w => cuerpoTexto.includes(w));

            const barrios = [
                'palermo', 'recoleta', 'belgrano', 'caballito', 'saavedra',
                'san telmo', 'puerto madero', 'almagro', 'villa crespo',
            ];
            const barrioEncontrado = barrios.find(
                b => cuerpoTexto.includes(b) || tituloTexto.toLowerCase().includes(b)
            );

            const propiedadData = {
                tipo_propiedad: cuerpoTexto.includes('casa') ? 'Casa' : 'Departamento',
                barrio_zona: barrioEncontrado
                    ? barrioEncontrado.charAt(0).toUpperCase() + barrioEncontrado.slice(1)
                    : 'Capital Federal',
                ambientes: dormitorios ? dormitorios + 1 : 1,
                dormitorios: dormitorios || 1,
                banos: banos || 1,
                superficie_total_m2: superficie_total_m2 || 45,
                superficie_cubierta_m2: superficie_total_m2
                    ? Math.floor(superficie_total_m2 * 0.9)
                    : 40,
                estado: check('estrenar', 'nuevo') ? 'Excelente' : 'Usado',
                anios_de_antiguedad: check('estrenar') ? 0 : 10,
                piso: parseInt(cuerpoTexto.match(/(?:piso|floor)\s*(\d+)/i)?.[1] || '1', 10),
                orientacion: 'No especificada',
                disposicion: cuerpoTexto.includes('frente')
                    ? 'Frente'
                    : cuerpoTexto.includes('contrafrente')
                    ? 'Contrafrente'
                    : 'No especificada',
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
                sum: check('sum', 'usos múltiples'),
                seguridad_tipo: check('seguridad', 'vigilancia') ? 'Física' : 'Ninguno',
                camara: check('camara', 'cámara', 'cctv'),
                gym: check('gym', 'gimnasio'),
                lounge: check('lounge'),
                laundry: check('laundry', 'lavadero'),
            };

            try {
                const resIA = await fetch('http://127.0.0.1:8000/estimar-precio', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(propiedadData),
                });

                const resultado = resIA.ok ? await resIA.json() : {};

                nuevosResultados.push({
                    id_propiedad,
                    ...propiedadData,
                    precio_real_usd: parseInt(precioTexto.replace(/\D/g, ''), 10),
                    precio_estimado_ia_usd: resultado.precio_estimado_usd || null,
                    coordenadas_gps: resultado.coordenadas || null,
                    fecha_publicacion: new Date().toISOString().split('T')[0],
                });
                console.log(`✨ Procesada con IA: ${id_propiedad}`);
            } catch {
                nuevosResultados.push({
                    id_propiedad,
                    ...propiedadData,
                    precio_real_usd: parseInt(precioTexto.replace(/\D/g, ''), 10),
                    fecha_publicacion: new Date().toISOString().split('T')[0],
                });
                console.log(`⚠️ Guardada sin IA: ${id_propiedad}`);
            }

            idsProcesados.add(id_propiedad);

            // Guardado incremental — si el script se corta no perdés nada
            const dataExistente = fs.existsSync(ARCHIVO_FINAL)
                ? JSON.parse(fs.readFileSync(ARCHIVO_FINAL, 'utf-8'))
                : [];
            fs.writeFileSync(
                ARCHIVO_FINAL,
                JSON.stringify([...dataExistente, nuevosResultados.at(-1)], null, 2)
            );

            await page.waitForTimeout(2000 + Math.random() * 2000);

        } catch (e) {
            console.error(`❌ Error en ${link}:`, e.message);
        }
    }

    console.log(`\n🏁 Scraping completado.`);
    console.log(`📊 Nuevas: ${nuevosResultados.length}`);

    await browser.close();
})();