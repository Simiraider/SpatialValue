import { chromium } from 'playwright';
import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: process.env.SpatialValueStorage_DATABASE_URL });

const waitForAny = async (page, selectors, timeout = 15000) => {
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
    return (valor >= 100 && valor <= 20000000) ? Math.round(valor) : null;
};

const calcularFechaPublicacion = (texto) => {
    const ahora = new Date();
    const match = texto.match(/publicado\s+(hace\s+[\w\s]+|hoy|ayer)/i);
    if (!match) return ahora.toISOString().split('T')[0];

    const frase = match[1].toLowerCase();
    let diasAtras = 0;

    if (frase.includes('hoy')) {
        diasAtras = 0;
    } else if (frase.includes('ayer')) {
        diasAtras = 1;
    } else {
        const numMatch = frase.match(/(\d+)/);
        const num = numMatch ? parseInt(numMatch[1], 10) : 1;

        if (frase.includes('día') || frase.includes('dia')) {
            diasAtras = num;
        } else if (frase.includes('mes')) {
            diasAtras = num * 30;
        } else if (frase.includes('año') || frase.includes('ano')) {
            diasAtras = num * 365;
        }
    }

    ahora.setDate(ahora.getDate() - diasAtras);
    return ahora.toISOString().split('T')[0];
};

(async () => {
    console.log("🚀 Iniciando scraper...");
    let browser;
    try {
        browser = await chromium.connectOverCDP('http://localhost:9222');
    } catch {
        console.error('❌ Error al conectar con Chrome via CDP (localhost:9222)');
        process.exit(1);
    }

    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();

    try {
        const PAGINAS_MAXIMAS = 10; 
        let linksTotales = [];

        const ES_VENTA = true; 
        const TIPO_OPERACION = ES_VENTA ? 'venta' : 'alquiler';

        for (let pagina = 1; pagina <= PAGINAS_MAXIMAS; pagina++) {
            const urlPagina = pagina === 1 
                ? `https://www.zonaprop.com.ar/casas-${TIPO_OPERACION}-capital-federal.html`
                : `https://www.zonaprop.com.ar/casas-${TIPO_OPERACION}-capital-federal-pagina-${pagina}.html`;

            try {
                console.log(`📄 Cargando página ${pagina}...`);
                await page.goto(urlPagina, { waitUntil: 'domcontentloaded', timeout: 30000 });
                const selectorListado = await waitForAny(page, [
                    '[data-qa="posting-card"]', '[data-posting-id]', 'div[class*="posting-card"]', 'ol[class*="postings"] li', 'article'
                ], 15000);

                if (!selectorListado) {
                    console.log(`⚠️ No se encontró listado en página ${pagina}, deteniendo paginación.`);
                    break;
                }
                await page.waitForTimeout(1000);

                const linksPagina = await page.evaluate(() =>
                    Array.from(document.querySelectorAll('a[href]'))
                        .map(a => a.href)
                        .filter(h => h.includes('zonaprop.com.ar') && h.match(/\/propiedades\/.*\.html/) && !h.includes('#'))
                );

                linksTotales.push(...linksPagina);

            } catch (err) {
                console.warn(`⚠️ Error cargando listado página ${pagina}: ${err.message}`);
                continue;
            }
        }

        const links = [...new Set(linksTotales)];
        console.log(`🔗 Se encontraron ${links.length} enlaces de propiedades.`);

        if (links.length === 0) {
            await browser.disconnect();
            return;
        }

        const { rows } = await pool.query('SELECT id_propiedad FROM propiedades');
        const idsProcesados = new Set(rows.map(r => r.id_propiedad));
        let nuevos = 0;

        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            const idMatch = link.match(/-(\d+)\.html/);
            const id_propiedad = idMatch ? `zp-${idMatch[1]}` : null;

            if (!id_propiedad || idsProcesados.has(id_propiedad)) {
                continue;
            }

            console.log(`[${i + 1}/${links.length}] Procesando ${id_propiedad}...`);

            const detailPage = await context.newPage();
            try {
                await detailPage.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await waitForAny(detailPage, ['[class*="price"]', '[class*="Price"]', '[data-qa="price"]'], 10000);

                const data = await detailPage.evaluate(() => {
                    // Clics nativos en JS para desplegar "ver más"
                    document.querySelectorAll('button, a, div, span').forEach(el => {
                        const t = (el.innerText || '').toLowerCase();
                        if (t === 'ver más' || t === 'ver mas') {
                            try { el.click(); } catch(e){}
                        }
                    });

                    const textoCompleto = document.body.innerText;
                    const textoLower = textoCompleto.toLowerCase();
                    const elTitulo = document.querySelector('h1,[data-qa="title"],[class*="TitleContainer"]');
                    const tituloTexto = elTitulo ? (elTitulo.innerText || elTitulo.textContent || '').trim().toLowerCase() : '';

                    let codigo_anunciante = null;
                    const matchCod = textoCompleto.match(/cód\.\s*del\s*anunciante:\s*([a-z0-9_-]+)/i);
                    if (matchCod) {
                        const cand = matchCod[1].trim();
                        const ignorar = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
                        if (cand.length >= 3 && !ignorar.includes(cand.toLowerCase()) && !/^\d{1,2}$/.test(cand)) {
                            codigo_anunciante = cand;
                        }
                    }

                    let direccion = null;
                    let barrio_zona = 'Capital Federal';
                    const h4Ubicacion = document.querySelector('#map-section h4, div[class*="section-location-property"] h4');

                    if (h4Ubicacion) {
                        const textoH4 = (h4Ubicacion.innerText || h4Ubicacion.textContent || '').trim();
                        const partes = textoH4.split(',').map(p => p.trim());

                        if (partes.length >= 2) {
                            direccion = partes[0];
                            barrio_zona = partes[1];
                        } else if (partes.length === 1) {
                            barrio_zona = partes[0];
                        }
                    }

                    let tipo_propiedad = 'Casa';
                    if (window.location.href.includes('/departamentos-') || tituloTexto.startsWith('departamento')) {
                        tipo_propiedad = 'Departamento';
                    } else if (window.location.href.includes('/ph-') || tituloTexto.startsWith('ph')) {
                        tipo_propiedad = 'PH';
                    }

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

                    let superficie_total = null;
                    let superficie_cubierta = null;
                    let ambientes = null;
                    let banos = null;
                    let dormitorios = null;
                    let anios_de_antiguedad = null;
                    let disposicion = 'No especificada';
                    let orientacion = 'No especificada';
                    let luminosidad = 'No especificada';

                    const featureNodes = document.querySelectorAll(
                        '[class*="icon-feature"], [class*="section-icon-features"] li, [data-qa="main-features"] > div, [class*="MainFeatures"] > div'
                    );

                    featureNodes.forEach(node => {
                        const txt = (node.innerText || '').trim();
                        const txtLower = txt.toLowerCase();

                        if (txtLower.includes('m² cub') || txtLower.includes('m2 cub')) {
                            const m = txt.match(/(\d+)/);
                            if (m) superficie_cubierta = parseInt(m[1], 10);
                        } else if (txtLower.includes('m²') || txtLower.includes('m2')) {
                            const m = txt.match(/(\d+)/);
                            if (m) superficie_total = parseInt(m[1], 10);
                        }

                        if (txtLower.includes('amb')) {
                            const m = txt.match(/(\d+)/);
                            if (m) ambientes = parseInt(m[1], 10);
                        }

                        if (txtLower.includes('baño')) {
                            const m = txt.match(/(\d+)/);
                            if (m) banos = parseInt(m[1], 10);
                        }

                        if (txtLower.includes('dorm')) {
                            const m = txt.match(/(\d+)/);
                            if (m) dormitorios = parseInt(m[1], 10);
                        }

                        if (txtLower.includes('estrenar')) {
                            anios_de_antiguedad = 0;
                        } else if (txtLower.includes('antigüe') || txtLower.includes('antigue') || txtLower.includes('año') || txtLower.includes('ano')) {
                            const m = txt.match(/(\d+)/);
                            if (m) anios_de_antiguedad = parseInt(m[1], 10);
                        }

                        if (txtLower === 'frente') disposicion = 'Frente';
                        if (txtLower === 'contrafrente') disposicion = 'Contrafrente';

                        if (['N', 'S', 'E', 'O', 'NE', 'NO', 'SE', 'SO'].includes(txt.toUpperCase())) {
                            orientacion = txt.toUpperCase();
                        }

                        if (txtLower.includes('luminoso')) {
                            luminosidad = txt;
                        }
                    });

                    if (!superficie_total && superficie_cubierta) superficie_total = superficie_cubierta;
                    if (!superficie_cubierta && superficie_total) superficie_cubierta = superficie_total;

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

                    return {
                        textoCompleto,
                        textoLower,
                        tituloTexto,
                        direccion,
                        barrio_zona,
                        codigo_anunciante,
                        tipo_propiedad,
                        precioUSD,
                        expensas,
                        superficie_total,
                        superficie_cubierta,
                        dormitorios,
                        banos,
                        ambientes,
                        anios_de_antiguedad,
                        disposicion,
                        orientacion,
                        luminosidad,
                        latitud,
                        longitud
                    };
                });

                const precio_real_usd = parsearPrecioUSD(data.precioUSD);
                if (!precio_real_usd) {
                    console.log(`⚠️ Precio no válido en ${id_propiedad}, omitiendo.`);
                    continue;
                }

                const fechaPublicacionCalculada = calcularFechaPublicacion(data.textoCompleto);
                const check = (...words) => words.some(w => data.textoLower.includes(w));

                const propiedadData = {
                    tipo_propiedad: data.tipo_propiedad,
                    barrio_zona: data.barrio_zona,
                    ambientes: data.ambientes || 1,
                    dormitorios: data.dormitorios || 1,
                    banos: data.banos || 1,
                    superficie_total_m2: data.superficie_total || null,
                    superficie_cubierta_m2: data.superficie_cubierta || null,
                    estado: data.anios_de_antiguedad === 0 ? 'A estrenar' : 'Usado',
                    anios_de_antiguedad: data.anios_de_antiguedad,
                    piso: parseInt(data.textoLower.match(/piso\s*(\d+)/i)?.[1] || '0', 10) || null,
                    orientacion: data.orientacion,
                    disposicion: data.disposicion,
                    cochera: check('cochera', 'garage', 'estacionamiento'),
                    balcon: check('balcon', 'balcón'),
                    terraza: check('terraza'),
                    patio: check('patio'),
                    pileta: check('pileta', 'piscina'),
                    parrilla: check('parrilla', 'quincho'),
                    seguridad_24hs: check('seguridad 24', 'vigilancia 24', 'vigilancia'),
                    ascensor: check('ascensor', 'ascensores', 'elevador'),
                    expensas_ars: data.expensas,
                    baulera: check('baulera'),
                    sum: check('sum', 'salón de usos'),
                    seguridad_tipo: check('seguridad', 'vigilancia') ? 'Física' : 'Ninguno',
                    camara: check('camara', 'cámara', 'cctv', 'circuito cerrado'),
                    gym: check('gym', 'gimnasio'),
                    lounge: check('lounge'),
                    laundry: check('laundry', 'lavadero'),
                    latitud: data.latitud,
                    longitud: data.longitud
                };

                let resultadoIA = {};
                try {
                    const resIA = await fetch('http://127.0.0.1:8000/estimar-precio', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(propiedadData),
                        signal: AbortSignal.timeout(3000) // Timeout de 3 segundos
                    });
                    if (resIA.ok) resultadoIA = await resIA.json();
                } catch (e) {
                    // Si la IA no responde a tiempo, no frena el scraper
                }

                const coordsFinales = (data.latitud && data.longitud)
                    ? { lat: data.latitud, lng: data.longitud }
                    : (resultadoIA.coordenadas || null);

                const query = `
                    INSERT INTO propiedades (
                        id_propiedad, url, tipo_propiedad, barrio_zona, ambientes, dormitorios, banos,
                        superficie_total_m2, superficie_cubierta_m2, estado, anios_de_antiguedad, piso,
                        orientacion, disposicion, cochera, balcon, terraza, patio, pileta, parrilla,
                        seguridad_24hs, ascensor, expensas_ars, baulera, sum, seguridad_tipo, camara,
                        gym, lounge, laundry, precio_real_usd, precio_estimado_ia_usd, coordenadas_gps, 
                        fecha_publicacion, tipo_operacion, codigo_anunciante, luminosidad, direccion
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 
                              $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, 
                              $34, $35, $36, $37, $38)
                    ON CONFLICT (id_propiedad) DO NOTHING;
                `;

                const values = [
                    id_propiedad, link, propiedadData.tipo_propiedad, propiedadData.barrio_zona, propiedadData.ambientes, propiedadData.dormitorios, propiedadData.banos,
                    propiedadData.superficie_total_m2, propiedadData.superficie_cubierta_m2, propiedadData.estado, propiedadData.anios_de_antiguedad, propiedadData.piso,
                    propiedadData.orientacion, propiedadData.disposicion, propiedadData.cochera, propiedadData.balcon, propiedadData.terraza, propiedadData.patio, propiedadData.pileta, propiedadData.parrilla,
                    propiedadData.seguridad_24hs, propiedadData.ascensor, propiedadData.expensas_ars, propiedadData.baulera, propiedadData.sum, propiedadData.seguridad_tipo, propiedadData.camara,
                    propiedadData.gym, propiedadData.lounge, propiedadData.laundry, precio_real_usd, resultadoIA.precio_estimado_usd || null, 
                    coordsFinales ? JSON.stringify(coordsFinales) : null, fechaPublicacionCalculada,
                    TIPO_OPERACION, data.codigo_anunciante, data.luminosidad, data.direccion
                ];

                await pool.query(query, values);
                nuevos++;
                console.log(`✅ Guardado: ${id_propiedad} (${data.direccion || data.barrio_zona}) - USD ${precio_real_usd}`);

            } catch (err) {
                console.error(`❌ Error procesando ${id_propiedad}: ${err.message}`);
            } finally {
                await detailPage.close().catch(() => {});
            }

            // Pausa de cortesía breve entre propiedades
            await new Promise(r => setTimeout(r, 800 + Math.random() * 800));
        }

        console.log(`\n🎉 Finalizado. Nuevas propiedades guardadas: ${nuevos}`);

        if (nuevos > 0) {
            try {
                await fetch('http://127.0.0.1:8000/reentrenar', { method: 'POST', signal: AbortSignal.timeout(5000) });
            } catch {}
        }

    } catch (e) {
        console.error(`❌ Error general en la ejecución: ${e.message}`);
    } finally {
        if (browser) await browser.disconnect();
        await pool.end();
    }
})();