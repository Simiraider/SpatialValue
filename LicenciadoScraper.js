import { chromium } from 'playwright';
import { Pool } from '@neondatabase/serverless';

// CONFIGURACIÓN

const pool = new Pool({ connectionString: process.env.SpatialValueStorage_DATABASE_URL });

const CONFIG = {
    PAGINAS_MAXIMAS: 10,
    URL_BASE: 'https://www.zonaprop.com.ar/departamentos-alquiler-capital-federal.html',
    URL_PAGINA: (n) => `https://www.zonaprop.com.ar/departamentos-alquiler-capital-federal-pagina-${n}.html`,
    CDP_ENDPOINT: 'http://localhost:9222',
    API_IA_URL: 'http://127.0.0.1:8000',
    NOMINATIM_URL: 'https://nominatim.openstreetmap.org/search',
    NOMINATIM_USER_AGENT: 'SpatialValue-Scraper/1.0 (49516747@est.ort.edu.ar)',
    NOMINATIM_DELAY_MS: 1000, 
    COORDENADAS_DEFAULT: { lat: -34.6037, lng: -58.3816 },
    DELAY_ENTRE_PROPIEDADES: [1500, 3000],
};

const BARRIOS = [
    'palermo', 'recoleta', 'belgrano', 'caballito', 'saavedra', 'san telmo',
    'puerto madero', 'almagro', 'villa crespo', 'flores', 'villa urquiza', 'colegiales',
    'chacarita', 'parque patricios', 'barracas', 'boedo', 'liniers', 'núñez', 'nunez',
    'villa del parque', 'paternal', 'agronomia', 'devoto', 'versalles'
];

// UTILIDADES 

const waitForAny = async (page, selectors, timeout = 30000) => {
    return Promise.race(
        selectors.map(sel =>
            page.waitForSelector(sel, { timeout }).then(() => sel).catch(() => null)
        )
    ).then(r => r ?? null);
};

const parsearPrecioUSD = (texto) => {
    if (!texto) return null;
    const match = texto.match(/USD\s*[\$]?\s*([\d.,]+)/i);
    if (!match) return null;
    const valor = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
    return (valor >= 100 && valor <= 50000) ? Math.round(valor) : null;
};

const delay = (min, max) => new Promise(r => setTimeout(r, min + Math.random() * (max - min)));

// Nominatim

const geocodeCache = new Map();

const geocodeDireccion = async (direccion) => {
    if (!direccion) return null;
    if (geocodeCache.has(direccion)) return geocodeCache.get(direccion);

    try {
        const url = `${CONFIG.NOMINATIM_URL}?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(direccion)}`;
        const res = await fetch(url, {
            headers: { 'User-Agent': CONFIG.NOMINATIM_USER_AGENT }
        });

        if (!res.ok) return null;

        const data = await res.json();
        if (!data || data.length === 0) return null;

        const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        geocodeCache.set(direccion, coords);
        return coords;

    } catch {
        return null;
    } finally {
        await new Promise(r => setTimeout(r, CONFIG.NOMINATIM_DELAY_MS));
    }
};

//Resolver

const resolverCoordenadas = async (direccionTexto, barrioEncontrado) => {
    if (direccionTexto) {
        const coords = await geocodeDireccion(`${direccionTexto}, Capital Federal, Argentina`);
        if (coords) return coords;
    }

    if (barrioEncontrado) {
        const coords = await geocodeDireccion(`${barrioEncontrado}, Capital Federal, Argentina`);
        if (coords) return coords;
    }

    return CONFIG.COORDENADAS_DEFAULT;
};

// Scraping

const obtenerLinksDeListado = async (page) => {
    let linksTotales = [];

    for (let pagina = 1; pagina <= CONFIG.PAGINAS_MAXIMAS; pagina++) {
        const urlPagina = pagina === 1 ? CONFIG.URL_BASE : CONFIG.URL_PAGINA(pagina);

        try {
            await page.goto(urlPagina, { waitUntil: 'domcontentloaded', timeout: 60000 });

            const selectorListado = await waitForAny(page, [
                '[data-qa="posting-card"]', '[data-posting-id]', 'div[class*="posting-card"]',
                'ol[class*="postings"] li', 'article'
            ], 30000);

            if (!selectorListado) break;

            await page.waitForTimeout(1500);

            const linksPagina = await page.evaluate(() =>
                Array.from(document.querySelectorAll('a[href]'))
                    .map(a => a.href)
                    .filter(h => h.includes('zonaprop.com.ar') && h.match(/\/propiedades\/.*\.html/) && !h.includes('#'))
            );

            linksTotales.push(...linksPagina);
            await page.waitForTimeout(1000);

        } catch {
            continue;
        }
    }

    return [...new Set(linksTotales)];
};

// SCRAPING: Propiedades

const extraerDatosCrudos = async (detailPage) => {
    return detailPage.evaluate(() => {
        const textoCompleto = document.body.innerText.toLowerCase();

        const elTitulo = document.querySelector('h1,[data-qa="title"],[class*="TitleContainer"]');
        const tituloTexto = elTitulo ? (elTitulo.innerText || elTitulo.textContent || '').trim().toLowerCase() : '';

        const elDireccion = document.querySelector('[data-qa="address"], h4[class*="Address"], [class*="AddressLine"]');
        const direccionTexto = elDireccion ? (elDireccion.innerText || '').trim() : '';

        let precioUSD = '';
        const byQa = document.querySelector('[data-qa="price"]');
        if (byQa) {
            precioUSD = byQa.innerText.trim();
        } else {
            const todosPrecios = [...document.querySelectorAll('[class*="Price"],[class*="price"]')];
            for (const el of todosPrecios) {
                if (!el.closest('[class*="xpens"],[class*="Expens"]')) {
                    const txt = el.innerText || el.textContent || '';
                    if (txt.includes('USD')) {
                        precioUSD = txt.trim();
                        break;
                    }
                }
            }
        }

        let expensas = 0;
        const candidatosExp = [...document.querySelectorAll('[class*="xpens"],[class*="Expens"],[data-qa="expenses"]')];
        for (const el of candidatosExp) {
            const txt = el.innerText || el.textContent || '';
            const m = txt.match(/[\d.,]+/);
            if (m) {
                expensas = parseInt(m[0].replace(/\./g, '').replace(',', ''), 10);
                break;
            }
        }

        let superficie = null;
        const resumen = document.querySelector('[class*="MainFeatures"],[class*="main-features"],[data-qa="main-features"]');
        if (resumen) {
            const m = (resumen.innerText || '').match(/(\d+)\s*m²/i);
            if (m) superficie = parseInt(m[1], 10);
        }

        let dormitorios = null;
        let banos = null;
        let ambientes = null;

        const items = [...document.querySelectorAll('[class*="feature"],[class*="Feature"]')];
        for (const el of items) {
            const txt = (el.innerText || '').toLowerCase();
            if (!superficie && txt.match(/m²|m2/i)) {
                const n = txt.match(/(\d+)/);
                if (n) superficie = parseInt(n[1], 10);
            }
            if (!dormitorios && txt.match(/dorm|hab/)) {
                const n = txt.match(/(\d+)/);
                if (n) dormitorios = parseInt(n[1], 10);
            }
            if (!banos && txt.includes('baño')) {
                const n = txt.match(/(\d+)/);
                if (n) banos = parseInt(n[1], 10);
            }
            if (!ambientes && txt.includes('ambiente')) {
                const n = txt.match(/(\d+)/);
                if (n) ambientes = parseInt(n[1], 10);
            }
        }

        return { textoCompleto, tituloTexto, direccionTexto, precioUSD, expensas, superficie, dormitorios, banos, ambientes };
    });
};

const normalizarDatos = (data) => {
    let superficie_total_m2 = data.superficie;
    if (!superficie_total_m2) {
        const m = data.textoCompleto.match(/(\d+)\s*m[²2]/);
        if (m) superficie_total_m2 = parseInt(m[1], 10);
    }
    if (superficie_total_m2 && superficie_total_m2 < 15) superficie_total_m2 = null;

    let dormitorios = data.dormitorios;
    if (!dormitorios) {
        const m = data.textoCompleto.match(/(\d+)\s*(?:dormitorio|dorm|habitaci)/);
        if (m) dormitorios = parseInt(m[1], 10);
    }

    let banos = data.banos;
    if (!banos) {
        const m = data.textoCompleto.match(/(\d+)\s*baño/);
        if (m) banos = parseInt(m[1], 10);
    }

    let ambientes = data.ambientes;
    if (!ambientes) {
        const m = data.textoCompleto.match(/(\d+)\s*ambiente/);
        if (m) ambientes = parseInt(m[1], 10);
    }
    if (!ambientes) ambientes = dormitorios ? dormitorios + 1 : 1;

    const check = (...words) => words.some(w => data.textoCompleto.includes(w));
    const barrioEncontrado = BARRIOS.find(b => data.textoCompleto.includes(b) || data.tituloTexto.includes(b));

    return {
        tipo_propiedad: data.textoCompleto.includes('casa') ? 'Casa' : 'Departamento',
        barrio_zona: barrioEncontrado ? barrioEncontrado.charAt(0).toUpperCase() + barrioEncontrado.slice(1) : 'Capital Federal',
        ambientes,
        dormitorios: dormitorios || 1,
        banos: banos || 1,
        superficie_total_m2: superficie_total_m2 || null,
        superficie_cubierta_m2: superficie_total_m2 ? Math.floor(superficie_total_m2 * 0.9) : null,
        estado: check('a estrenar', 'estrenar') ? 'A estrenar' : 'Usado',
        anios_de_antiguedad: check('estrenar') ? 0 : null,
        piso: parseInt(data.textoCompleto.match(/piso\s*(\d+)/i)?.[1] || '0', 10) || null,
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
        expensas_ars: data.expensas,
        baulera: check('baulera'),
        sum: check('sum', 'salón de usos'),
        seguridad_tipo: check('seguridad', 'vigilancia') ? 'Física' : 'Ninguno',
        camara: check('camara', 'cámara', 'cctv'),
        gym: check('gym', 'gimnasio'),
        lounge: check('lounge'),
        laundry: check('laundry', 'lavadero'),
        // metadata auxiliar usada solo para geocoding, no se persiste tal cual
        _direccionTexto: data.direccionTexto,
        _barrioEncontrado: barrioEncontrado,
    };
};

//API ia
const estimarPrecioIA = async (propiedadData) => {
    try {
        const res = await fetch(`${CONFIG.API_IA_URL}/estimar-precio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(propiedadData)
        });
        if (res.ok) return await res.json();
    } catch {
    }
    return {};
};

const solicitarReentrenamiento = async () => {
    try {
        await fetch(`${CONFIG.API_IA_URL}/reentrenar`, { method: 'POST' });
    } catch {
    }
};

// Bases de datos

const obtenerIdsExistentes = async () => {
    const { rows } = await pool.query('SELECT id_propiedad FROM propiedades');
    return new Set(rows.map(r => r.id_propiedad));
};

const guardarPropiedad = async ({ id_propiedad, link, propiedadData, precio_real_usd, resultadoIA, coordenadas }) => {
    const query = `
        INSERT INTO propiedades (
            id_propiedad, url, tipo_propiedad, barrio_zona, ambientes, dormitorios, banos,
            superficie_total_m2, superficie_cubierta_m2, estado, anios_de_antiguedad, piso,
            orientacion, disposicion, cochera, balcon, terraza, patio, pileta, parrilla,
            seguridad_24hs, ascensor, expensas_ars, baulera, sum, seguridad_tipo, camara,
            gym, lounge, laundry, precio_real_usd, precio_estimado_ia_usd, coordenadas_gps, fecha_publicacion
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                  $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34)
        ON CONFLICT (id_propiedad) DO NOTHING;
    `;

    const values = [
        id_propiedad, link, propiedadData.tipo_propiedad, propiedadData.barrio_zona, propiedadData.ambientes,
        propiedadData.dormitorios, propiedadData.banos, propiedadData.superficie_total_m2, propiedadData.superficie_cubierta_m2,
        propiedadData.estado, propiedadData.anios_de_antiguedad, propiedadData.piso, propiedadData.orientacion,
        propiedadData.disposicion, propiedadData.cochera, propiedadData.balcon, propiedadData.terraza, propiedadData.patio,
        propiedadData.pileta, propiedadData.parrilla, propiedadData.seguridad_24hs, propiedadData.ascensor,
        propiedadData.expensas_ars, propiedadData.baulera, propiedadData.sum, propiedadData.seguridad_tipo,
        propiedadData.camara, propiedadData.gym, propiedadData.lounge, propiedadData.laundry,
        precio_real_usd, resultadoIA.precio_estimado_usd || null,
        JSON.stringify(coordenadas), new Date().toISOString().split('T')[0]
    ];

    await pool.query(query, values);
};

// ============================================================
// PROCESAMIENTO DE UNA PROPIEDAD INDIVIDUAL
// ============================================================

const procesarPropiedad = async (context, link, id_propiedad) => {
    const detailPage = await context.newPage();

    try {
        await detailPage.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await waitForAny(detailPage, ['[class*="price"]', '[class*="Price"]', '[data-qa="price"]'], 15000);

        const dataCruda = await extraerDatosCrudos(detailPage);

        const precio_real_usd = parsearPrecioUSD(dataCruda.precioUSD);
        if (!precio_real_usd) return false;

        const propiedadData = normalizarDatos(dataCruda);

        // Geolocalización real vía Nominatim (con fallback a barrio y luego a CABA)
        const coordenadas = await resolverCoordenadas(propiedadData._direccionTexto, propiedadData._barrioEncontrado);
        propiedadData.latitud = coordenadas.lat;
        propiedadData.longitud = coordenadas.lng;

        const resultadoIA = await estimarPrecioIA(propiedadData);

        await guardarPropiedad({ id_propiedad, link, propiedadData, precio_real_usd, resultadoIA, coordenadas });

        await delay(...CONFIG.DELAY_ENTRE_PROPIEDADES);
        return true;

    } catch {
        return false;
    } finally {
        await detailPage.close().catch(() => {});
    }
};

// ============================================================
// MAIN
// ============================================================

(async () => {
    console.log('Iniciando scraper');

    let browser;
    try {
        browser = await chromium.connectOverCDP(CONFIG.CDP_ENDPOINT);
    } catch {
        console.error(`Error CDP ${CONFIG.CDP_ENDPOINT}`);
        process.exit(1);
    }

    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();

    try {
        const links = await obtenerLinksDeListado(page);

        if (links.length === 0) {
            await browser.disconnect();
            return;
        }

        const idsProcesados = await obtenerIdsExistentes();
        let nuevos = 0;

        for (const link of links) {
            const idMatch = link.match(/-(\d+)\.html/);
            const id_propiedad = idMatch ? `zp-${idMatch[1]}` : null;
            if (!id_propiedad || idsProcesados.has(id_propiedad)) continue;

            const guardado = await procesarPropiedad(context, link, id_propiedad);
            if (guardado) nuevos++;
        }

        console.log(`\nNuevas propiedades guardadas en Neon: ${nuevos}`);

        if (nuevos > 0) {
            await solicitarReentrenamiento();
        }

    } catch (e) {
        console.error(`Error general: ${e.message}`);
    } finally {
        if (browser) await browser.close();
        await pool.end();
    }
})();