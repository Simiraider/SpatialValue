import { chromium } from 'playwright';
import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: process.env.SpatialValueStorage_DATABASE_URL });

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

(async () => {
    console.log("Iniciando scraper...");
    let browser;
    try {
        browser = await chromium.connectOverCDP('http://localhost:9222');
    } catch {
        console.error('❌ Error CDP localhost:9222');
        process.exit(1);
    }

    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();

    try {
        const PAGINAS_MAXIMAS = 10; 
        let linksTotales = [];

        for (let pagina = 1; pagina <= PAGINAS_MAXIMAS; pagina++) {
            const urlPagina = pagina === 1 
                ? 'https://www.zonaprop.com.ar/departamentos-alquiler-capital-federal.html'
                : `https://www.zonaprop.com.ar/departamentos-alquiler-capital-federal-pagina-${pagina}.html`;

            try {
                await page.goto(urlPagina, { waitUntil: 'domcontentloaded', timeout: 60000 });
                const selectorListado = await waitForAny(page, [
                    '[data-qa="posting-card"]', '[data-posting-id]', 'div[class*="posting-card"]', 'ol[class*="postings"] li', 'article'
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

        const links = [...new Set(linksTotales)];
        if (links.length === 0) {
            await browser.disconnect();
            return;
        }

        const { rows } = await pool.query('SELECT id_propiedad FROM propiedades');
        const idsProcesados = new Set(rows.map(r => r.id_propiedad));
        let nuevos = 0;

        for (const link of links) {
            const idMatch = link.match(/-(\d+)\.html/);
            const id_propiedad = idMatch ? `zp-${idMatch[1]}` : null;
            if (!id_propiedad || idsProcesados.has(id_propiedad)) continue;

            const detailPage = await context.newPage();
            try {
                await detailPage.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 });
                await waitForAny(detailPage, ['[class*="price"]', '[class*="Price"]', '[data-qa="price"]'], 15000);

                const data = await detailPage.evaluate(() => {
                    const textoCompleto = document.body.innerText.toLowerCase();
                    const elTitulo = document.querySelector('h1,[data-qa="title"],[class*="TitleContainer"]');
                    const tituloTexto = elTitulo ? (elTitulo.innerText || elTitulo.textContent || '').trim().toLowerCase() : '';

                    // 1. TIPO DE PROPIEDAD REAL (Basado en la URL o título, no en texto aleatorio)
                    let tipo_propiedad = 'Departamento';
                    if (window.location.href.includes('/casas-') || tituloTexto.startsWith('casa')) {
                        tipo_propiedad = 'Casa';
                    } else if (window.location.href.includes('/ph-') || tituloTexto.startsWith('ph')) {
                        tipo_propiedad = 'PH';
                    }

                    // 2. EXTRAER COORDENADAS REALES DE SCRIPTS
                    let latitud = null;
                    let longitud = null;

                    const scripts = Array.from(document.querySelectorAll('script'));
                    for (const script of scripts) {
                        const content = script.textContent || '';
                        if (content.includes('latitude') && content.includes('longitude')) {
                            const latMatch = content.match(/"latitude"\s*:\s*(-?\d+\.\d+)/);
                            const lngMatch = content.match(/"longitude"\s*:\s*(-?\d+\.\d+)/);
                            if (latMatch && lngMatch) {
                                latitud = parseFloat(latMatch[1]);
                                longitud = parseFloat(lngMatch[1]);
                                break;
                            }
                        }
                    }

                    // 3. EXTRAER CARACTERÍSTICAS PRINCIPALES DE LA GRILLA DE ÍCONOS
                    let superficie_total = null;
                    let superficie_cubierta = null;
                    let ambientes = null;
                    let banos = null;
                    let dormitorios = null;
                    let disposicion = 'No especificada';
                    let orientacion = 'No especificada';

                    // Seleccionar ítems específicos de la grilla principal
                    const featureNodes = document.querySelectorAll(
                        '[class*="icon-feature"], [class*="section-icon-features"] li, [data-qa="main-features"] > div, [class*="MainFeatures"] > div'
                    );

                    featureNodes.forEach(node => {
                        const txt = (node.innerText || '').trim();
                        const txtLower = txt.toLowerCase();

                        // Superficie cubierta / total
                        if (txtLower.includes('m² cub') || txtLower.includes('m2 cub')) {
                            const m = txt.match(/(\d+)/);
                            if (m) superficie_cubierta = parseInt(m[1], 10);
                        } else if (txtLower.includes('m²') || txtLower.includes('m2')) {
                            const m = txt.match(/(\d+)/);
                            if (m) superficie_total = parseInt(m[1], 10);
                        }

                        // Ambientes
                        if (txtLower.includes('amb')) {
                            const m = txt.match(/(\d+)/);
                            if (m) ambientes = parseInt(m[1], 10);
                        }

                        // Baños
                        if (txtLower.includes('baño')) {
                            const m = txt.match(/(\d+)/);
                            if (m) banos = parseInt(m[1], 10);
                        }

                        // Dormitorios
                        if (txtLower.includes('dorm')) {
                            const m = txt.match(/(\d+)/);
                            if (m) dormitorios = parseInt(m[1], 10);
                        }

                        // Disposición
                        if (txtLower === 'frente') disposicion = 'Frente';
                        if (txtLower === 'contrafrente') disposicion = 'Contrafrente';
                        if (txtLower === 'lateral') disposicion = 'Lateral';
                        if (txtLower === 'interno') disposicion = 'Interno';

                        // Orientación
                        if (['n', 's', 'e', 'o', 'ne', 'no', 'se', 'so'].includes(txtLower.toUpperCase())) {
                            orientacion = txt.toUpperCase();
                        }
                    });

                    // Si superficie_total no vino explícita pero si cubierta, igualarlas por defecto
                    if (!superficie_total && superficie_cubierta) superficie_total = superficie_cubierta;
                    if (!superficie_cubierta && superficie_total) superficie_cubierta = superficie_total;

                    // Precio USD
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

                    // Expensas
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

                    return {
                        textoCompleto,
                        tituloTexto,
                        tipo_propiedad,
                        precioUSD,
                        expensas,
                        superficie_total,
                        superficie_cubierta,
                        dormitorios,
                        banos,
                        ambientes,
                        disposicion,
                        orientacion,
                        latitud,
                        longitud
                    };
                });

                const precio_real_usd = parsearPrecioUSD(data.precioUSD);
                if (!precio_real_usd) continue;

                const check = (...words) => words.some(w => data.textoCompleto.includes(w));
                const barrios = ['palermo', 'recoleta', 'belgrano', 'caballito', 'saavedra', 'san telmo',
                    'puerto madero', 'almagro', 'villa crespo', 'flores', 'villa urquiza', 'colegiales',
                    'chacarita', 'parque patricios', 'barracas', 'boedo', 'liniers', 'núñez', 'nunez',
                    'villa del parque', 'paternal', 'agronomia', 'devoto', 'versalles'];
                const barrioEncontrado = barrios.find(b => data.textoCompleto.includes(b) || data.tituloTexto.includes(b));

                const propiedadData = {
                    tipo_propiedad: data.tipo_propiedad,
                    barrio_zona: barrioEncontrado ? barrioEncontrado.charAt(0).toUpperCase() + barrioEncontrado.slice(1) : 'Capital Federal',
                    ambientes: data.ambientes || 1,
                    dormitorios: data.dormitorios || 1,
                    banos: data.banos || 1,
                    superficie_total_m2: data.superficie_total || null,
                    superficie_cubierta_m2: data.superficie_cubierta || null,
                    estado: check('a estrenar', 'estrenar') ? 'A estrenar' : 'Usado',
                    anios_de_antiguedad: check('estrenar') ? 0 : null,
                    piso: parseInt(data.textoCompleto.match(/piso\s*(\d+)/i)?.[1] || '0', 10) || null,
                    orientacion: data.orientacion,
                    disposicion: data.disposicion,
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
                    latitud: data.latitud,
                    longitud: data.longitud
                };

                let resultadoIA = {};
                try {
                    const resIA = await fetch('http://127.0.0.1:8000/estimar-precio', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(propiedadData)
                    });
                    if (resIA.ok) resultadoIA = await resIA.json();
                } catch {}

                const coordsFinales = (data.latitud && data.longitud)
                    ? { lat: data.latitud, lng: data.longitud }
                    : (resultadoIA.coordenadas || null);

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
                    id_propiedad, link, propiedadData.tipo_propiedad, propiedadData.barrio_zona, propiedadData.ambientes, propiedadData.dormitorios, propiedadData.banos,
                    propiedadData.superficie_total_m2, propiedadData.superficie_cubierta_m2, propiedadData.estado, propiedadData.anios_de_antiguedad, propiedadData.piso,
                    propiedadData.orientacion, propiedadData.disposicion, propiedadData.cochera, propiedadData.balcon, propiedadData.terraza, propiedadData.patio, propiedadData.pileta, propiedadData.parrilla,
                    propiedadData.seguridad_24hs, propiedadData.ascensor, propiedadData.expensas_ars, propiedadData.baulera, propiedadData.sum, propiedadData.seguridad_tipo, propiedadData.camara,
                    propiedadData.gym, propiedadData.lounge, propiedadData.laundry, precio_real_usd, resultadoIA.precio_estimado_usd || null, 
                    coordsFinales ? JSON.stringify(coordsFinales) : null, new Date().toISOString().split('T')[0]
                ];

                await pool.query(query, values);
                nuevos++;
                await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));

            } catch {
            } finally {
                await detailPage.close().catch(() => {});
            }
        }

        console.log(`\n Nuevas propiedades guardadas en Neon: ${nuevos}`);

        if (nuevos > 0) {
            try {
                await fetch('http://127.0.0.1:8000/reentrenar', { method: 'POST' });
            } catch {}
        }

    } catch (e) {
        console.error(`❌ Error general: ${e.message}`);
    } finally {
        if (browser) await browser.close();
        await pool.end();
    }
})();