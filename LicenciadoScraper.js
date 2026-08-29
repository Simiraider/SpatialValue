// =========================================================================
// 1. IMPORTACIÓN DE MÓDULOS Y CONFIGURACIÓN DE CONEXIONES
// =========================================================================
import 'dotenv/config';
import { firefox } from 'playwright';
import ws from 'ws';
import { Pool, neonConfig } from '@neondatabase/serverless';

// Configurar WebSockets para NeonDB en entornos Node.js / Linux VPS
neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.SpatialValueStorage_DATABASE_URL });
const IA_URL = process.env.IA_URL || 'http://127.0.0.1:8000';

// =========================================================================
// 2. FUNCIONES AUXILIARES Y HELPER UTILS
// =========================================================================

// ESPERA DINÁMICA POR CUALQUIERA DE LOS SELECTORES PROPORCIONADOS
const waitForAny = async (page, selectors, timeout = 15000) => {
    return Promise.race(
        selectors.map(sel =>
            page.waitForSelector(sel, { timeout }).then(() => sel).catch(() => null)
        )
    ).then(r => r ?? null);
};

// HELPER PARA EXTRAER SUPERFICIE (NÚMERO INDIVIDUAL O RANGO)
const parsearSuperficie = (texto) => {
    if (!texto) return { min: null, max: null, valor: null };
    const matchRango = texto.match(/(\d+)\s*(?:a|-|hasta)\s*(\d+)/i);
    if (matchRango) {
        const min = parseInt(matchRango[1], 10);
        const max = parseInt(matchRango[2], 10);
        return { min, max, valor: Math.round((min + max) / 2) };
    }
    const matchUnico = texto.match(/(\d+)/);
    if (matchUnico) {
        const val = parseInt(matchUnico[1], 10);
        return { min: val, max: val, valor: val };
    }
    return { min: null, max: null, valor: null };
};

// EXTRACCIÓN Y LIMPIEZA DEL PRECIO EN DÓLARES (USD / U$S / $)
const parsearPrecioUSD = (texto) => {
    if (!texto) return 0;
    const match = texto.match(/(?:USD|U\$S|\$)\s*([\d.,]+)/i) || texto.match(/([\d.,]+)/);
    if (!match) return 0;
    const valor = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
    return (valor >= 100 && valor <= 20000000) ? Math.round(valor) : 0;
};

// CÁLCULO DE FECHA RELATIVA PRIORIZANDO TEXTO EXACTO DEL DOM
const calcularFechaPublicacion = (textoFecha) => {
    if (!textoFecha) return null;

    const limpio = textoFecha.replace(/\s+/g, ' ').trim();

    const match = limpio.match(/(?:publicado\s+)?hace\s+(\d+)\s*(día|días|dia|dias|mes|meses|año|años|ano|anos)/i);
    if (match) {
        const num = parseInt(match[1], 10);
        const unidad = match[2].toLowerCase();
        let diasAtras = num;

        if (unidad.startsWith('mes')) {
            diasAtras = num * 30;
        } else if (unidad.startsWith('año') || unidad.startsWith('ano')) {
            diasAtras = num * 365;
        }

        const fechaCalculada = new Date();
        fechaCalculada.setDate(fechaCalculada.getDate() - diasAtras);
        return fechaCalculada.toISOString().split('T')[0];
    }

    if (/publicado\s+hoy/i.test(limpio)) return new Date().toISOString().split('T')[0];
    if (/publicado\s+ayer/i.test(limpio)) {
        const f = new Date();
        f.setDate(f.getDate() - 1);
        return f.toISOString().split('T')[0];
    }

    return null;
};

// GEOCODIFICACIÓN DE RESPALDO CON API MAPBOX
const geocodificarDireccion = async (direccion, barrio) => {
    if (!direccion) return null;

    const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN;
    if (!mapboxToken) {
        console.warn('MAPBOX_ACCESS_TOKEN no está definido en el entorno.');
        return null;
    }

    const queryTexto = `${direccion}, ${barrio || 'Capital Federal'}, Buenos Aires, Argentina`;
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(queryTexto)}.json?access_token=${mapboxToken}&country=ar&limit=1`;

    try {
        const res = await fetch(url);
        if (!res.ok) return null;

        const data = await res.json();
        if (data && data.features && data.features.length > 0) {
            const [lng, lat] = data.features[0].center;
            return { lat, lng };
        }
    } catch (e) {
        console.warn(`Error al geocodificar con Mapbox (${direccion}): ${e.message}`);
    }
    return null;
};

// =========================================================================
// 3. FLUJO PRINCIPAL DEL SCRAPER (MAIN ASYNC)
// =========================================================================
(async () => {
    console.log("Iniciando scraper en servidor VPS (Modo Firefox Stealth)...");
    let browser;

    try {
        const proxyServer = process.env.THORDATA_PROXY_SERVER || process.env.PROXY_SERVER;
        const proxyUser = process.env.THORDATA_USER || process.env.PROXY_USER;
        const proxyPass = process.env.THORDATA_PASSWORD || process.env.PROXY_PASS;

        browser = await firefox.launch({
            headless: true,
            proxy: (proxyServer && proxyUser && proxyPass) ? {
                server: proxyServer,
                username: proxyUser,
                password: proxyPass
            } : undefined
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
            locale: 'es-AR',
            timezoneId: 'America/Argentina/Buenos_Aires',
            viewport: { width: 1366, height: 768 }
        });

        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        const page = await context.newPage();

        await page.route('**/*', (route) => {
            const resource = route.request().resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resource)) {
                route.abort();
            } else {
                route.continue();
            }
        });

        const PAGINAS_MAXIMAS = 10; 
        let linksTotales = [];

        const ES_VENTA = true; 
        const TIPO_OPERACION = ES_VENTA ? 'venta' : 'alquiler';

        for (let pagina = 1; pagina <= PAGINAS_MAXIMAS; pagina++) {
            const urlPagina = pagina === 1 
                ? `https://www.zonaprop.com.ar/casas-${TIPO_OPERACION}-capital-federal.html`
                : `https://www.zonaprop.com.ar/casas-${TIPO_OPERACION}-capital-federal-pagina-${pagina}.html`;

            try {
                console.log(`Cargando página ${pagina}...`);
                await page.goto(urlPagina, { waitUntil: 'domcontentloaded', timeout: 35000 });
                
                const selectorListado = await waitForAny(page, [
                    '[data-qa="posting-card"]', '[data-posting-id]', 'div[class*="posting-card"]', 'ol[class*="postings"] li', 'article'
                ], 15000);

                if (!selectorListado) {
                    console.log(`No se encontró listado en página ${pagina}, deteniendo paginación.`);
                    break;
                }

                const linksPagina = await page.evaluate(() =>
                    Array.from(document.querySelectorAll('a[href]'))
                        .map(a => a.href)
                        .filter(h => h.includes('zonaprop.com.ar') && h.match(/\/propiedades\/.*\.html/) && !h.includes('#'))
                );

                linksTotales.push(...linksPagina);

            } catch (err) {
                console.warn(`Error cargando listado página ${pagina}: ${err.message}`);
                continue;
            }
        }

        const links = [...new Set(linksTotales)];
        console.log(`Se encontraron ${links.length} enlaces únicos de propiedades.`);

        if (links.length === 0) {
            await browser.close();
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
            await detailPage.route('**/*', (route) => {
                if (['image', 'stylesheet', 'font', 'media'].includes(route.request().resourceType())) {
                    route.abort();
                } else {
                    route.continue();
                }
            });

            try {
                const response = await detailPage.goto(link, { waitUntil: 'domcontentloaded', timeout: 35000 });
                
                const tituloPagina = await detailPage.title();
                if ((response && (response.status() === 403 || response.status() === 429)) || 
                    tituloPagina.includes('Cloudflare') || tituloPagina.includes('Just a moment') || tituloPagina.includes('Attention Required')) {
                    console.warn(`⚠️ Bloqueado por anti-bot en ${id_propiedad}. Omitiendo para reintentar luego.`);
                    await detailPage.close().catch(() => {});
                    await new Promise(r => setTimeout(r, 6000));
                    continue;
                }

                await waitForAny(detailPage, ['[class*="price"]', '[class*="Price"]', '[data-qa="price"]'], 8000);

                await detailPage.evaluate(async () => {
                    window.scrollTo(0, document.body.scrollHeight / 2);
                    await new Promise(r => setTimeout(r, 300));
                    window.scrollTo(0, document.body.scrollHeight);
                    await new Promise(r => setTimeout(r, 500));
                });

                try {
                    await detailPage.waitForSelector('text=/Publicado hace/i', { timeout: 4000 });
                } catch (e) {
                    await detailPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                    await detailPage.waitForTimeout(600);
                }

                const textoFechaNodo = await detailPage.evaluate(() => {
                    const todos = Array.from(document.querySelectorAll('*'));
                    const coincidencia = todos.find(n => n.children.length === 0 && /publicado\s+hace/i.test(n.innerText || ''));
                    if (coincidencia) return coincidencia.innerText;

                    const match = document.body.innerText.match(/publicado\s+hace\s+\d+\s*(?:día|días|dia|dias|mes|meses|año|años|ano|anos)/i);
                    return match ? match[0] : '';
                });

                let fechaPublicacionCalculada = calcularFechaPublicacion(textoFechaNodo);
                if (!fechaPublicacionCalculada) {
                    console.warn(`⚠️ No se pudo extraer fecha relativa para ${id_propiedad}. Se mantendrá en revisión.`);
                    fechaPublicacionCalculada = new Date().toISOString().split('T')[0];
                }

                let textoPestanasAcumulado = '';
                const pestañasAExplorar = ['Características generales', 'Ambientes', 'Servicios', 'Instalaciones'];

                for (const pestanaNombre of pestañasAExplorar) {
                    const selectorTab = detailPage.locator(`button:has-text("${pestanaNombre}"), [role="tab"]:has-text("${pestanaNombre}")`).first();
                    if (await selectorTab.isVisible().catch(() => false)) {
                        await selectorTab.click({ force: true }).catch(() => {});
                        await detailPage.waitForTimeout(300);
                        const textoDomActual = await detailPage.evaluate(() => document.body.innerText);
                        textoPestanasAcumulado += ' ' + textoDomActual;
                    }
                }

                const data = await detailPage.evaluate((textoAdicionalTabs) => {
                    document.querySelectorAll('button, a, div, span').forEach(el => {
                        const t = (el.innerText || '').toLowerCase().trim();
                        if (t === 'ver más' || t === 'ver mas') {
                            try { el.click(); } catch(e){}
                        }
                    });

                    let latitudState = null;
                    let longitudState = null;
                    let direccionState = null;
                    let barrioState = null;
                    let precioState = '';

                    try {
                        const scripts = Array.from(document.querySelectorAll('script'));
                        const scriptState = scripts.find(s => s.textContent && s.textContent.includes('__INITIAL_STATE__'));
                        if (scriptState) {
                            const jsonMatch = scriptState.textContent.match(/__INITIAL_STATE__\s*=\s*({.*?});/s);
                            if (jsonMatch) {
                                const state = JSON.parse(jsonMatch[1]);
                                const posting = state.posting || state.postings?.[0];
                                if (posting) {
                                    latitudState = posting.postingLocation?.geolocation?.latitude || null;
                                    longitudState = posting.postingLocation?.geolocation?.longitude || null;
                                    direccionState = posting.postingLocation?.address || posting.postingLocation?.name || null;
                                    barrioState = posting.postingLocation?.location?.name || null;
                                    const priceObj = posting.priceOperationTypes?.[0]?.prices?.[0];
                                    if (priceObj) {
                                        precioState = `${priceObj.currency} ${priceObj.amount}`;
                                    }
                                }
                            }
                        }
                    } catch(e) {}

                    const textoCompleto = (document.body.innerText + ' ' + textoAdicionalTabs);
                    const textoLower = textoCompleto.toLowerCase();
                    const elTitulo = document.querySelector('h1,[data-qa="title"],[class*="TitleContainer"]');
                    const tituloTexto = elTitulo ? (elTitulo.innerText || elTitulo.textContent || '').trim().toLowerCase() : '';

                    // DETECCIÓN DE ESTADO EN CONSTRUCCIÓN / EN POZO
                    let esEnConstruccion = false;
                    if (
                        textoLower.includes('en construcción') || textoLower.includes('en construccion') ||
                        textoLower.includes('en pozo') || textoLower.includes('emprendimiento') ||
                        textoLower.includes('en obra') || textoLower.includes('al pozo')
                    ) {
                        esEnConstruccion = true;
                    }

                    // EXTRACCIÓN DE CANTIDAD DE PISOS / PLANTAS DE LA CASA
                    let cantidad_pisos = null;
                    const matchPlantasNum = textoCompleto.match(/(?:cantidad\s+de\s+)?(?:plantas|pisos|niveles)\s*[:=]\s*(\d+)/i);
                    if (matchPlantasNum) {
                        cantidad_pisos = parseInt(matchPlantasNum[1], 10);
                    } else {
                        const matchPlantasTxt = textoCompleto.match(/(?:en|de)\s*(\d+|\bdos\b|\btres\b|\bcuatro\b|\bcinco\b|\buna\b)\s*(?:plantas|pisos|niveles)/i);
                        if (matchPlantasTxt) {
                            const val = matchPlantasTxt[1].toLowerCase();
                            const mapaNumeros = { 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5 };
                            cantidad_pisos = mapaNumeros[val] || parseInt(val, 10) || null;
                        }
                    }

                    let codigo_anunciante = null;
                    const matchCod = textoCompleto.match(/cód\.\s*del\s*anunciante:\s*([^|\n\r]+)/i);
                    if (matchCod) {
                        const cand = matchCod[1].trim();
                        if (cand.length >= 2) codigo_anunciante = cand;
                    }

                    let calificacion_usuarios = null;
                    const elScore = document.querySelector('div[class*="score-title"], div[class*="scoreTitle"], div[class*="scoreLevel"]');
                    if (elScore) {
                        const txt = (elScore.innerText || elScore.textContent || '').trim();
                        const match = txt.match(/\d+/);
                        if (match) calificacion_usuarios = parseInt(match[0], 10);
                    }
                    if (calificacion_usuarios === null) {
                        const matchNivel = textoCompleto.match(/nivel\s*(\d+)/i);
                        if (matchNivel) calificacion_usuarios = parseInt(matchNivel[1], 10);
                    }

                    let direccion = direccionState;
                    let barrio_zona = barrioState || 'Capital Federal';
                    const h4Ubicacion = document.querySelector('#map-section h4, div[class*="section-location-property"] h4');

                    if (!direccion && h4Ubicacion) {
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

                    let latitud = latitudState;
                    let longitud = longitudState;
                    if (!latitud || !longitud) {
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

                        // EXTRACCIÓN DE PLANTAS / PISOS EN CARACTERÍSTICAS TÉCNICAS
                        if (txtLower.includes('planta') || txtLower.includes('nivel')) {
                            const m = txt.match(/(\d+)/);
                            if (m) cantidad_pisos = parseInt(m[1], 10);
                        }

                        // PARSEO DE SUPERFICIES CON SOPORTE PARA RANGOS (Ej: "50 a 120 m²")
                        if (txtLower.includes('m² cub') || txtLower.includes('m2 cub')) {
                            const matchRango = txt.match(/(\d+)\s*(?:a|-|hasta)\s*(\d+)/i);
                            const matchUnico = txt.match(/(\d+)/);
                            if (matchRango) {
                                superficie_cubierta = Math.round((parseInt(matchRango[1], 10) + parseInt(matchRango[2], 10)) / 2);
                            } else if (matchUnico) {
                                superficie_cubierta = parseInt(matchUnico[1], 10);
                            }
                        } else if (txtLower.includes('m²') || txtLower.includes('m2')) {
                            const matchRango = txt.match(/(\d+)\s*(?:a|-|hasta)\s*(\d+)/i);
                            const matchUnico = txt.match(/(\d+)/);
                            if (matchRango) {
                                superficie_total = Math.round((parseInt(matchRango[1], 10) + parseInt(matchRango[2], 10)) / 2);
                            } else if (matchUnico) {
                                superficie_total = parseInt(matchUnico[1], 10);
                            }
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
                        } else if (txtLower.includes('en construcción') || txtLower.includes('en pozo') || txtLower.includes('en obra')) {
                            esEnConstruccion = true;
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

                    let precioUSD = precioState;
                    if (!precioUSD) {
                        const byQa = document.querySelector('[data-qa="price"]');
                        if (byQa) {
                            precioUSD = byQa.innerText.trim();
                        } else {
                            const todosPrecios = [...document.querySelectorAll('[class*="Price"],[class*="price"]')];
                            for (const el of todosPrecios) {
                                if (!el.closest('[class*="xpens"],[class*="Expens"]')) {
                                    const txt = el.innerText || el.textContent || '';
                                    if (txt.includes('USD') || txt.includes('U$S') || txt.includes('$')) {
                                        precioUSD = txt.trim();
                                        break;
                                    }
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
                        direccion,
                        barrio_zona,
                        codigo_anunciante,
                        calificacion_usuarios,
                        tipo_propiedad,
                        precioUSD,
                        expensas,
                        superficie_total,
                        superficie_cubierta,
                        dormitorios,
                        banos,
                        ambientes,
                        anios_de_antiguedad,
                        esEnConstruccion,
                        cantidad_pisos,
                        disposicion,
                        orientacion,
                        luminosidad,
                        latitud,
                        longitud
                    };
                }, textoPestanasAcumulado);

                const precio_real_usd = parsearPrecioUSD(data.precioUSD) || 0;

                if (precio_real_usd === 0 && !data.direccion) {
                    console.warn(`⚠️ Datos incompletos en ${id_propiedad}. Omitiendo registración.`);
                    continue;
                }

                const check = (...words) => words.some(w => data.textoLower.includes(w));

                const tieneCamara = check('camara', 'cámara', 'cctv', 'circuito cerrado');
                const tieneSeguridadFisica = check('seguridad', 'vigilancia', 'guardia', 'totem', 'encargado');
                const esSeguridad24hs = check('seguridad 24', 'vigilancia 24', '24hs', '24 hs', '24hrs') || tieneSeguridadFisica || tieneCamara;

                // DETERMINAR ESTADO FINAL PARA DB
                let estadoFinal = 'Usado';
                if (data.esEnConstruccion) {
                    estadoFinal = 'En construcción';
                } else if (data.anios_de_antiguedad === 0) {
                    estadoFinal = 'A estrenar';
                }

                // PISO: Si es Casa guarda la cantidad de plantas/pisos, si es Departamento guarda el número de piso
                let pisoFinal = null;
                if (data.tipo_propiedad === 'Casa') {
                    pisoFinal = data.cantidad_pisos || null;
                } else {
                    pisoFinal = parseInt(data.textoLower.match(/piso\s*(\d+)/i)?.[1] || '0', 10) || null;
                }

                const propiedadData = {
                    tipo_propiedad: data.tipo_propiedad,
                    barrio_zona: data.barrio_zona,
                    ambientes: data.ambientes || 1,
                    dormitorios: data.dormitorios || 1,
                    banos: data.banos || 1,
                    superficie_total_m2: data.superficie_total || null,
                    superficie_cubierta_m2: data.superficie_cubierta || null,
                    estado: estadoFinal,
                    anios_de_antiguedad: data.esEnConstruccion ? 0 : data.anios_de_antiguedad,
                    piso: pisoFinal,
                    cantidad_pisos: data.cantidad_pisos || null,
                    orientacion: data.orientacion,
                    disposicion: data.disposicion,
                    cochera: check('cochera', 'garage', 'estacionamiento'),
                    balcon: check('balcon', 'balcón'),
                    terraza: check('terraza'),
                    patio: check('patio'),
                    pileta: check('pileta', 'piscina'),
                    parrilla: check('parrilla', 'quincho'),
                    seguridad_24hs: esSeguridad24hs,
                    ascensor: check('ascensor', 'ascensores', 'elevador'),
                    expensas_ars: data.expensas,
                    baulera: check('baulera'),
                    sum: check('sum', 'salón de usos'),
                    seguridad_tipo: tieneSeguridadFisica ? 'Física' : 'Ninguno',
                    camara: tieneCamara,
                    gym: check('gym', 'gimnasio'),
                    lounge: check('lounge'),
                    laundry: check('laundry', 'lavadero'),
                    latitud: data.latitud,
                    longitud: data.longitud
                };

                let codigoAnuncianteFinal = data.codigo_anunciante;
                const codLower = (codigoAnuncianteFinal || '').toLowerCase().trim();
                if (!codigoAnuncianteFinal || codLower === '13' || codLower === 'acuña' || codLower.length < 3) {
                    codigoAnuncianteFinal = `REF-${id_propiedad.replace('zp-', '')}`;
                }

                // CONSULTA A MICROSERVICIO DE IA
                let resultadoIA = {};
                try {
                    const resIA = await fetch(`${IA_URL}/estimar-precio`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-API-KEY': process.env.INTERNAL_API_KEY || ''
                        },
                        body: JSON.stringify(propiedadData)
                    });
                    if (resIA.ok) resultadoIA = await resIA.json();
                } catch (e) {}

                // GEOCODIFICACIÓN TRIPLE FALLBACK
                let coordsFinales = (data.latitud && data.longitud)
                    ? { lat: data.latitud, lng: data.longitud }
                    : (resultadoIA.coordenadas || null);

                if (!coordsFinales && data.direccion) {
                    coordsFinales = await geocodificarDireccion(data.direccion, data.barrio_zona);
                    await new Promise(r => setTimeout(r, 800));
                }

                let precioEstimadoIaUsd = resultadoIA.precio_estimado_usd 
                    ? Math.round(Number(resultadoIA.precio_estimado_usd)) 
                    : null;

                if (!precioEstimadoIaUsd && (propiedadData.superficie_cubierta_m2 || propiedadData.superficie_total_m2)) {
                    const sup = propiedadData.superficie_cubierta_m2 || propiedadData.superficie_total_m2;
                    const barrioLower = (data.barrio_zona || '').toLowerCase();
                    const valorM2 = ['belgrano', 'recoleta', 'palermo', 'puerto madero'].some(b => barrioLower.includes(b)) ? 1650 : 1250;
                    precioEstimadoIaUsd = Math.round(sup * valorM2);
                }

                // INSERCIÓN EN LA BASE DE DATOS NEON DB
                const query = `
                    INSERT INTO propiedades (
                        id_propiedad, url, tipo_operacion, fecha_publicacion,
                        direccion, barrio_zona, coordenadas_gps,
                        tipo_propiedad, ambientes, dormitorios, banos,
                        superficie_total_m2, superficie_cubierta_m2, piso,
                        estado, anios_de_antiguedad, orientacion, disposicion, luminosidad,
                        precio_real_usd, precio_estimado_ia_usd, expensas_ars,
                        cochera, balcon, terraza, patio, pileta, parrilla, ascensor, baulera, sum, gym, lounge, laundry,
                        seguridad_24hs, seguridad_tipo, camara,
                        codigo_anunciante, calificacion_usuarios
                    ) VALUES (
                        $1, $2, $3, $4,
                        $5, $6, $7,
                        $8, $9, $10, $11,
                        $12, $13, $14,
                        $15, $16, $17, $18, $19,
                        $20, $21, $22,
                        $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34,
                        $35, $36, $37,
                        $38, $39
                    )
                    ON CONFLICT (id_propiedad) DO NOTHING;
                `;

                const values = [
                    id_propiedad, link, TIPO_OPERACION, fechaPublicacionCalculada,
                    data.direccion, propiedadData.barrio_zona, coordsFinales ? JSON.stringify(coordsFinales) : null,
                    propiedadData.tipo_propiedad, propiedadData.ambientes, propiedadData.dormitorios, propiedadData.banos,
                    propiedadData.superficie_total_m2, propiedadData.superficie_cubierta_m2, propiedadData.piso,
                    propiedadData.estado, propiedadData.anios_de_antiguedad, propiedadData.orientacion, propiedadData.disposicion, data.luminosidad,
                    precio_real_usd, precioEstimadoIaUsd, propiedadData.expensas_ars,
                    propiedadData.cochera, propiedadData.balcon, propiedadData.terraza, propiedadData.patio, propiedadData.pileta, propiedadData.parrilla, propiedadData.ascensor, propiedadData.baulera, propiedadData.sum, propiedadData.gym, propiedadData.lounge, propiedadData.laundry,
                    propiedadData.seguridad_24hs, propiedadData.seguridad_tipo, propiedadData.camara,
                    codigoAnuncianteFinal, data.calificacion_usuarios
                ];

                await pool.query(query, values);
                nuevos++;
                console.log(`Guardado: ${id_propiedad} | Tipo: ${propiedadData.tipo_propiedad} | Estado: ${propiedadData.estado} | Sup M2: ${propiedadData.superficie_total_m2} | Plantas/Piso: ${propiedadData.piso || 'N/A'} | Precio USD: ${precio_real_usd}`);

            } catch (err) {
                console.error(`Error procesando ${id_propiedad}: ${err.message}`);
            } finally {
                await detailPage.close().catch(() => {});
            }

            // PAUSA ALEATORIA ENTRE PETICIONES
            await new Promise(r => setTimeout(r, 4000 + Math.random() * 3000));
        }

        console.log(`\nFinalizado. Nuevas propiedades guardadas: ${nuevos}`);

        // REENTRENAMIENTO AUTOMÁTICO DE MODELO IA
        if (nuevos > 0) {
            try {
                await fetch(`${IA_URL}/reentrenar`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-KEY': process.env.INTERNAL_API_KEY || '',
                    },
                    signal: AbortSignal.timeout(5000),
                });
            } catch {}
        }

    } catch (e) {
        console.error(`Error general en la ejecución: ${e.message}`);
    } finally {
        if (browser) await browser.close();
        await pool.end();
    }
})();