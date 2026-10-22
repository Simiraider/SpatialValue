import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { Pool } from '@neondatabase/serverless';

dotenv.config({ path: '.env.local' });
dotenv.config();

const CONFIG = {
    PAGINAS_MAXIMAS: 10,
    URL_BASE: 'https://www.zonaprop.com.ar/casas-venta-capital-federal.html',
    URL_PAGINA: (n) => `https://www.zonaprop.com.ar/casas-venta-capital-federal-pagina-${n}.html`,
    HEADLESS: true,
    IA_URL: process.env.IA_URL || 'http://127.0.0.1:8000',
    IA_API_KEY: process.env.INTERNAL_API_KEY || '',
    DB_URL: process.env.SpatialValueStorage_DATABASE_URL || process.env.DATABASE_URL || process.env.NEON_DATABASE_URL,
    NOMINATIM_URL: 'https://nominatim.openstreetmap.org/search',
    NOMINATIM_USER_AGENT: 'SpatialValue-Scraper/2.0 (contacto@spatialvalue.com)',
    NOMINATIM_DELAY_MS: 1100,
    COORDENADAS_DEFAULT: { lat: -34.6037, lng: -58.3816 },
    DELAY_ENTRE_PROPIEDADES: [1000, 2000],
    PESTANIAS_A_EXPANDIR: ['Características generales', 'Ambientes', 'Servicios', 'Instalaciones'],
};

if (!CONFIG.DB_URL) {
    console.error('No se encontró la variable de base de datos en .env ni .env.local');
    process.exit(1);
}

const pool = new Pool({ connectionString: CONFIG.DB_URL });

/**
 * Convierte cualquier valor a entero apto para PostgreSQL INTEGER.
 * Redondea flotantes (ej. 307457.76 -> 307458) y convierte nulos/inválidos a null.
 */
const toNullableInt = (val) => {
    if (val === null || val === undefined || val === '') return null;
    const num = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
    if (isNaN(num)) return null;
    return Math.round(num);
};

/**
 * Detecta si un texto de dirección es en realidad un título de propiedad
 * (ej: "Casa · 500m² · 10 ambientes · 5 dormitorios")
 */
const esTituloNoDireccion = (texto) => {
    if (!texto) return true;
    const txt = texto.trim();
    if (txt.includes('·') || txt.includes('m²') || txt.includes('m2')) return true;
    if (/^(casa|departamento|depto|ph|terreno|local|oficina|emprendimiento)\b/i.test(txt)) return true;
    if (/\b\d+\s*amb/i.test(txt) || /\b\d+\s*dorm/i.test(txt)) return true;
    return false;
};

const waitForAny = async (page, selectors, timeout = 10000) => {
    return Promise.race(
        selectors.map(sel =>
            page.waitForSelector(sel, { timeout }).then(() => sel).catch(() => null)
        )
    ).then(r => r ?? null);
};

const parsearPrecioUSD = (texto) => {
    if (!texto) return 0;
    const match = texto.match(/(?:USD|U\$S|\$)\s*([\d.,]+)/i) || texto.match(/([\d.,]+)/);
    if (!match) return 0;
    const valor = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
    return (valor >= 100 && valor <= 20000000) ? Math.round(valor) : 0;
};

const calcularFechaPublicacion = (textoFecha) => {
    if (!textoFecha) return new Date().toISOString().split('T')[0];

    const limpio = textoFecha.replace(/\s+/g, ' ').trim();
    const match = limpio.match(/(?:publicado\s+)?hace\s+(\d+)\s*(día|días|dia|dias|mes|meses|año|años|ano|anos)/i);

    if (match) {
        const num = parseInt(match[1], 10);
        const unidad = match[2].toLowerCase();
        let diasAtras = num;

        if (unidad.startsWith('mes')) diasAtras = num * 30;
        else if (unidad.startsWith('año') || unidad.startsWith('ano')) diasAtras = num * 365;

        const fecha = new Date();
        fecha.setDate(fecha.getDate() - diasAtras);
        return fecha.toISOString().split('T')[0];
    }

    if (/publicado\s+hoy/i.test(limpio)) return new Date().toISOString().split('T')[0];
    if (/publicado\s+ayer/i.test(limpio)) {
        const f = new Date();
        f.setDate(f.getDate() - 1);
        return f.toISOString().split('T')[0];
    }

    return new Date().toISOString().split('T')[0];
};

/**
 * Normaliza una dirección para generar el slug de Fichaprop.ar
 */
const normalizarDireccionFichaprop = (direccion) => {
    if (!direccion || esTituloNoDireccion(direccion)) return null;

    let dir = direccion.toLowerCase();
    dir = dir.split(/\bentre\b/i)[0]; // Elimina intersecciones
    dir = dir.replace(/\bal\b/g, ' ');  // Elimina la palabra "al"

    const slug = dir
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\bavda?\.?\b/g, 'avenida')
        .replace(/\bpje\.?\b/g, 'pasaje')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');

    return slug.length > 2 ? slug : null;
};

const delay = (min, max) => new Promise(r => setTimeout(r, min + Math.random() * (max - min)));

const esCoordenadaCABA = (lat, lng) => {
    if (!lat || !lng) return false;
    return (lat >= -34.7100 && lat <= -34.5000) && (lng >= -58.5500 && lng <= -58.3200);
};

const limpiarDireccionGeocode = (direccion) => {
    if (!direccion || esTituloNoDireccion(direccion)) return '';
    return direccion
        .replace(/\bal\b/gi, ' ')
        .replace(/\bavda?\.?\b/gi, 'Avenida ')
        .split(/\bentre\b|\.|\,/i)[0]
        .replace(/\s+/g, ' ')
        .trim();
};

const geocodeCache = new Map();

const geocodeDireccion = async (queryTexto) => {
    if (!queryTexto) return null;
    if (geocodeCache.has(queryTexto)) return geocodeCache.get(queryTexto);

    try {
        const url = `${CONFIG.NOMINATIM_URL}?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(queryTexto)}`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': CONFIG.NOMINATIM_USER_AGENT,
                'Accept-Language': 'es-AR,es;q=0.9'
            }
        });
        if (!res.ok) return null;

        const data = await res.json();
        if (!data || data.length === 0) return null;

        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);

        if (esCoordenadaCABA(lat, lng)) {
            const coords = { lat, lng };
            geocodeCache.set(queryTexto, coords);
            return coords;
        }
        return null;
    } catch {
        return null;
    } finally {
        await new Promise(r => setTimeout(r, CONFIG.NOMINATIM_DELAY_MS));
    }
};

const resolverCoordenadas = async (direccionTexto, barrioZona) => {
    const dirLimpia = limpiarDireccionGeocode(direccionTexto);

    if (dirLimpia && dirLimpia.length > 3) {
        const coordsExactas = await geocodeDireccion(`${dirLimpia}, Capital Federal, Buenos Aires, Argentina`);
        if (coordsExactas) return coordsExactas;

        const coordsCABA = await geocodeDireccion(`${dirLimpia}, CABA, Argentina`);
        if (coordsCABA) return coordsCABA;
    }

    if (barrioZona) {
        const barrioLimpio = barrioZona.split(',')[0].trim();
        const coordsBarrio = await geocodeDireccion(`${barrioLimpio}, Capital Federal, Buenos Aires, Argentina`);
        if (coordsBarrio) return coordsBarrio;
    }

    return CONFIG.COORDENADAS_DEFAULT;
};

const consultarFichaprop = async (context, direccion) => {
    const slug = normalizarDireccionFichaprop(direccion);
    if (!slug) return null;

    const pageFP = await context.newPage();
    try {
        const response = await pageFP.goto(`https://fichaprop.ar/edificio/${slug}`, {
            waitUntil: 'domcontentloaded',
            timeout: 10000,
        }).catch(() => null);

        if (!response || response.status() !== 200) return null;

        await pageFP.waitForSelector('main, #__next, body', { timeout: 4000 }).catch(() => {});

        return await pageFP.evaluate(() => {
            const textoCompleto = document.body ? document.body.innerText : '';
            if (textoCompleto.toLowerCase().includes('no encontramos este edificio')) return null;

            const spans = Array.from(document.querySelectorAll('span, p, div'));
            const comunaSpan = spans.find(s => (s.textContent || '').toLowerCase().includes('comuna'));
            const comunaText = comunaSpan ? comunaSpan.textContent.trim() : null;

            const obtenerTextoBloque = (palabraClave) => {
                const elementos = Array.from(document.querySelectorAll('div, section, article, p, span'));
                const claveLower = palabraClave.toLowerCase();
                for (const el of elementos) {
                    const txt = (el.innerText || el.textContent || '').trim();
                    if (txt.toLowerCase().includes(claveLower) && txt.length < 150) {
                        return txt.replace(/\n/g, ' - ');
                    }
                }
                return null;
            };

            const matchResenas = textoCompleto.match(/(\d+)\s*reseñas/i);

            return {
                ruido: obtenerTextoBloque('dba') || obtenerTextoBloque('ruido'),
                obras: obtenerTextoBloque('obras'),
                subte: obtenerTextoBloque('subte'),
                plazas: obtenerTextoBloque('plazas'),
                escuelas: obtenerTextoBloque('escuelas'),
                comuna: comunaText,
                resenas: matchResenas ? parseInt(matchResenas[1], 10) : 0,
            };
        });
    } catch {
        return null;
    } finally {
        await pageFP.close().catch(() => {});
    }
};

const obtenerLinksDeListado = async (page) => {
    const linksTotales = [];

    for (let pagina = 1; pagina <= CONFIG.PAGINAS_MAXIMAS; pagina++) {
        const urlPagina = pagina === 1 ? CONFIG.URL_BASE : CONFIG.URL_PAGINA(pagina);
        console.log(`\n[Listado] Página ${pagina}/${CONFIG.PAGINAS_MAXIMAS}: ${urlPagina}`);

        try {
            const response = await page.goto(urlPagina, { waitUntil: 'domcontentloaded', timeout: 60000 });
            console.log(`[Listado] HTTP ${response?.status() ?? 'sin respuesta'} | URL final: ${page.url()}`);
            console.log(`[Listado] Título: ${await page.title().catch(() => '(sin título)')}`);

            if (response && [403, 429].includes(response.status())) {
                console.warn(`[Listado] Zonaprop respondió HTTP ${response.status()}. Se detiene la paginación; no se puede extraer esta página.`);
                break;
            }

            // No exigir que aparezca una tarjeta concreta: Zonaprop cambia sus selectores.
            await waitForAny(page, [
                '[data-qa="posting-card"]', '[data-posting-id]', 'div[class*="posting-card"]',
                'ol[class*="postings"] li', 'article', 'a[href*="/propiedades/"]'
            ], 12000);
            await page.waitForTimeout(1200);

            const resultado = await page.evaluate(() => {
                const enlaces = Array.from(document.querySelectorAll('a[href]'))
                    .map(a => {
                        try {
                            const u = new URL(a.href, location.href);
                            if (!/(^|\.)zonaprop\.com\.ar$/i.test(u.hostname)) return null;
                            u.hash = '';
                            u.search = '';
                            return u.href.replace(/\/$/, '');
                        } catch { return null; }
                    })
                    .filter(Boolean)
                    .filter(h => /\/propiedades\/[^?#]*-\d+\.html$/i.test(h));
                const texto = (document.body?.innerText || '').slice(0, 500).replace(/\s+/g, ' ');
                return { enlaces, texto };
            });

            const linksPagina = [...new Set(resultado.enlaces)];
            console.log(`[Listado] Página ${pagina}: ${linksPagina.length} enlaces de propiedades detectados.`);
            if (linksPagina.length === 0) {
                console.warn(`[Listado] Sin enlaces. Texto visible inicial: ${resultado.texto || '(vacío)'}`);
                // Continuamos una página más por si el HTML de esta página fue atípico.
            }
            linksTotales.push(...linksPagina);
            await page.waitForTimeout(900);
        } catch (err) {
            console.warn(`[Listado] Página ${pagina}: error al cargar: ${err.message}`);
        }
    }

    return [...new Set(linksTotales)];
};

const esPaginaBloqueada = async (detailPage, response) => {
    const tituloPagina = await detailPage.title();
    return (
        (response && (response.status() === 403 || response.status() === 429)) ||
        tituloPagina.includes('Cloudflare') ||
        tituloPagina.includes('Attention Required')
    );
};

const expandirPestanias = async (detailPage) => {
    let textoAcumulado = '';
    for (const pestania of CONFIG.PESTANIAS_A_EXPANDIR) {
        const selector = detailPage.locator(`button:has-text("${pestania}"), [role="tab"]:has-text("${pestania}")`).first();
        if (await selector.isVisible().catch(() => false)) {
            await selector.click({ force: true }).catch(() => {});
            await detailPage.waitForTimeout(150);
            textoAcumulado += ' ' + await detailPage.evaluate(() => document.body?.innerText || '');
        }
    }
    return textoAcumulado;
};

const extraerDatosDePagina = (textoAdicionalTabs) => {
    const esTituloOMedida = (str) => {
        if (!str) return true;
        const s = str.trim();
        if (s.includes('·') || s.includes('m²') || s.includes('m2') || s.toLowerCase().includes('ambientes')) return true;
        if (/^(casa|departamento|depto|ph|terreno|local|oficina|emprendimiento)\b/i.test(s)) return true;
        return false;
    };

    const extraerObjetoBalanceado = (texto, inicioLlave) => {
        let profundidad = 0;
        let enString = false;
        let escape = false;
        for (let i = inicioLlave; i < texto.length; i++) {
            const c = texto[i];
            if (escape) { escape = false; continue; }
            if (c === '\\') { escape = true; continue; }
            if (c === '"') { enString = !enString; continue; }
            if (enString) continue;
            if (c === '{') profundidad++;
            if (c === '}') {
                profundidad--;
                if (profundidad === 0) return texto.slice(inicioLlave, i + 1);
            }
        }
        return null;
    };

    let latitudState = null;
    let longitudState = null;
    let direccionState = null;
    let barrioState = null;
    let precioState = '';
    let supTotalState = null;
    let supCubiertaState = null;

    try {
        const scripts = Array.from(document.querySelectorAll('script'));
        const scriptState = scripts.find(s => s.textContent && s.textContent.includes('__INITIAL_STATE__'));
        if (scriptState) {
            const idxMarca = scriptState.textContent.indexOf('__INITIAL_STATE__');
            const idxLlave = scriptState.textContent.indexOf('{', idxMarca);
            if (idxLlave !== -1) {
                const jsonTexto = extraerObjetoBalanceado(scriptState.textContent, idxLlave);
                if (jsonTexto) {
                    const state = JSON.parse(jsonTexto);
                    const posting = state.posting || (state.postings && state.postings[0]);
                    if (posting) {
                        latitudState = posting.postingLocation?.geolocation?.latitude || null;
                        longitudState = posting.postingLocation?.geolocation?.longitude || null;
                        
                        const candidateAddress = posting.postingLocation?.address || posting.postingLocation?.realAddress || null;
                        if (candidateAddress && !esTituloOMedida(candidateAddress)) {
                            direccionState = candidateAddress;
                        }

                        barrioState = posting.postingLocation?.location?.name || posting.postingLocation?.zone?.name || null;
                        
                        const priceObj = posting.priceOperationTypes?.[0]?.prices?.[0];
                        if (priceObj) precioState = `${priceObj.currency || ''} ${priceObj.amount || ''}`;

                        const mainFeat = posting.mainFeatures || posting.sectionFeatures || {};
                        Object.values(mainFeat).forEach(feat => {
                            const label = (feat.label || feat.name || '').toLowerCase();
                            const val = parseInt(feat.value, 10);
                            if (!isNaN(val)) {
                                if (label.includes('total')) supTotalState = val;
                                if (label.includes('cubierta')) supCubiertaState = val;
                            }
                        });
                    }
                }
            }
        }
    } catch {
        // Fallback al DOM
    }

    const textoCompleto = (document.body ? document.body.innerText : '') + ' ' + (textoAdicionalTabs || '');
    const textoLower = textoCompleto.toLowerCase();

    const esEnConstruccion = /en construcci[oó]n|en pozo|emprendimiento|al pozo/.test(textoLower);

    let direccion = direccionState;
    if (!direccion) {
        const elDirDOM = document.querySelector('[data-qa="section-location-property"] h2, [class*="section-location"] h2, [class*="LocationTitle"], [class*="location-title"]');
        if (elDirDOM) {
            const txt = (elDirDOM.innerText || elDirDOM.textContent || '').trim();
            if (!esTituloOMedida(txt)) {
                direccion = txt;
            }
        }
    }

    const barrio_zona = barrioState || 'Capital Federal';

    let superficie_total = supTotalState;
    let superficie_cubierta = supCubiertaState;
    let ambientes = null;
    let banos = null;
    let dormitorios = null;
    let anios_de_antiguedad = null;
    let disposicion = 'No especificada';
    let orientacion = 'No especificada';

    const featureNodes = Array.from(document.querySelectorAll(
        '[class*="icon-feature"], [class*="section-icon-features"] li, [data-qa="main-features"] > div, [class*="MainFeatures"] > div, [class*="feature-item"]'
    ));

    featureNodes.forEach(node => {
        const txt = (node.innerText || node.textContent || '').trim();
        const txtLower = txt.toLowerCase();

        if (txtLower.includes('m² cub') || txtLower.includes('m2 cub') || txtLower.includes('cubierta')) {
            const matchRango = txt.match(/(\d+)\s*(?:a|-|hasta)\s*(\d+)/i);
            const matchUnico = txt.match(/(\d+)/);
            if (!superficie_cubierta) {
                if (matchRango) superficie_cubierta = Math.round((parseInt(matchRango[1], 10) + parseInt(matchRango[2], 10)) / 2);
                else if (matchUnico) superficie_cubierta = parseInt(matchUnico[1], 10);
            }
        } 
        else if (txtLower.includes('m² tot') || txtLower.includes('m2 tot') || txtLower.includes('m² total') || txtLower.includes('m2 total') || txtLower.includes('sup. total') || txtLower.includes('superficie total')) {
            const matchRango = txt.match(/(\d+)\s*(?:a|-|hasta)\s*(\d+)/i);
            const matchUnico = txt.match(/(\d+)/);
            if (!superficie_total) {
                if (matchRango) superficie_total = Math.round((parseInt(matchRango[1], 10) + parseInt(matchRango[2], 10)) / 2);
                else if (matchUnico) superficie_total = parseInt(matchUnico[1], 10);
            }
        }
        else if ((txtLower.includes('m²') || txtLower.includes('m2')) && !superficie_total) {
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
        } else if (txtLower.includes('antigüe') || txtLower.includes('antigue') || txtLower.includes('año')) {
            const m = txt.match(/(\d+)/);
            if (m) anios_de_antiguedad = parseInt(m[1], 10);
        }

        if (txtLower === 'frente') disposicion = 'Frente';
        if (txtLower === 'contrafrente') disposicion = 'Contrafrente';
        if (['N', 'S', 'E', 'O', 'NE', 'NO', 'SE', 'SO'].includes(txt.toUpperCase())) orientacion = txt.toUpperCase();
    });

    if (!superficie_total) {
        const matchSupTot = textoCompleto.match(/(\d+)\s*m²?\s*(?:totales|total|tot\b)/i) ||
                            textoCompleto.match(/superficie\s+total[:\s]+(\d+)/i) ||
                            textoCompleto.match(/(\d+)\s*m²?\s*de\s+superficie\s+total/i);
        if (matchSupTot) {
            superficie_total = parseInt(matchSupTot[1], 10);
        }
    }

    if (!superficie_cubierta) {
        const matchSupCub = textoCompleto.match(/(\d+)\s*m²?\s*(?:cubiertos|cubierta|cub\b)/i) ||
                            textoCompleto.match(/superficie\s+cubierta[:\s]+(\d+)/i);
        if (matchSupCub) {
            superficie_cubierta = parseInt(matchSupCub[1], 10);
        }
    }

    const pareceExpensas = (txt) => /expensa/i.test(txt);
    const esNodoDeDescuento = (el) => !!el.closest('[class*="discount" i],[id*="discount" i]');

    let precioUSD = precioState;

    if (!precioUSD) {
        const porClaseEspecifica = document.querySelector(
            '[class*="price-value" i]:not([class*="discount" i]), [class*="PriceValue" i]'
        );
        if (porClaseEspecifica && !esNodoDeDescuento(porClaseEspecifica)) {
            const txt = (porClaseEspecifica.innerText || porClaseEspecifica.textContent || '').trim();
            if (txt && !pareceExpensas(txt) && /(?:USD|U\$S|\$)\s*[\d.,]+/i.test(txt)) precioUSD = txt;
        }
    }

    if (!precioUSD) {
        const byQa = document.querySelector('[data-qa="price"]');
        if (byQa && !esNodoDeDescuento(byQa)) {
            const txt = (byQa.innerText || byQa.textContent || '').trim();
            if (txt && !pareceExpensas(txt)) precioUSD = txt;
        }
    }

    if (!precioUSD) {
        const candidatos = [...document.querySelectorAll('[class*="Price"],[class*="price"]')];
        for (const el of candidatos) {
            if (el.closest('[class*="xpens"],[class*="Expens"]')) continue;
            if (esNodoDeDescuento(el)) continue;
            const txt = (el.innerText || el.textContent || '').trim();
            if (txt && txt.length < 40 && !pareceExpensas(txt) && /(?:USD|U\$S|\$)\s*[\d.,]+/i.test(txt)) {
                precioUSD = txt;
                break;
            }
        }
    }

    if (!precioUSD) {
        const matchTexto = textoCompleto.match(/(?:USD|U\$S)\s*[\d.,]+/i);
        if (matchTexto) precioUSD = matchTexto[0];
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
        textoLower,
        direccion,
        barrio_zona,
        tipo_propiedad: textoLower.includes('casa') ? 'Casa' : 'Departamento',
        precioUSD,
        expensas,
        superficie_total,
        superficie_cubierta,
        dormitorios,
        banos,
        ambientes,
        anios_de_antiguedad,
        esEnConstruccion,
        disposicion,
        orientacion,
        latitud: latitudState,
        longitud: longitudState,
    };
};

const construirPropiedadData = (data) => {
    const check = (...words) => words.some(w => data.textoLower.includes(w));

    let estadoFinal = 'Usado';
    if (data.esEnConstruccion) estadoFinal = 'En construcción';
    else if (data.anios_de_antiguedad === 0) estadoFinal = 'A estrenar';

    let dirFinal = data.direccion ? data.direccion.trim() : null;
    if (dirFinal && esTituloNoDireccion(dirFinal)) dirFinal = null;
    if (dirFinal && dirFinal.length > 50) dirFinal = dirFinal.slice(0, 50).trim();

    return {
        tipo_propiedad: data.tipo_propiedad,
        barrio_zona: (data.barrio_zona || 'Capital Federal').trim().slice(0, 50),
        direccion: dirFinal,
        ambientes: data.ambientes || 1,
        dormitorios: data.dormitorios || 1,
        banos: data.banos || 1,
        superficie_total_m2: data.superficie_total || null,
        superficie_cubierta_m2: data.superficie_cubierta || null,
        estado: estadoFinal,
        anios_de_antiguedad: data.anios_de_antiguedad,
        piso: parseInt(data.textoLower.match(/piso\s*(\d+)/i)?.[1] || '0', 10) || null,
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
    };
};

const headersIA = () => ({
    'Content-Type': 'application/json',
    ...(CONFIG.IA_API_KEY ? { 'X-Api-Key': CONFIG.IA_API_KEY } : {}),
});

const estimarPrecioIA = async (propiedadData) => {
    try {
        const res = await fetch(`${CONFIG.IA_URL}/estimar-precio`, {
            method: 'POST',
            headers: headersIA(),
            body: JSON.stringify(propiedadData),
        });
        if (res.ok) return await res.json();
    } catch {
        // opcional
    }
    return {};
};

const resolverCoordsFinales = async (data, resultadoIA, propiedadData) => {
    if (esCoordenadaCABA(data.latitud, data.longitud)) {
        return { lat: data.latitud, lng: data.longitud };
    }
    if (resultadoIA.coordenadas && esCoordenadaCABA(resultadoIA.coordenadas.lat, resultadoIA.coordenadas.lng)) {
        return resultadoIA.coordenadas;
    }
    return resolverCoordenadas(propiedadData.direccion, propiedadData.barrio_zona);
};

const guardarPropiedad = async (campos) => {
    const query = `
        INSERT INTO propiedades (
            id_propiedad, url, tipo_propiedad, barrio_zona, direccion, ambientes, dormitorios, banos,
            superficie_total_m2, superficie_cubierta_m2, estado, anios_de_antiguedad, piso,
            orientacion, disposicion, cochera, balcon, terraza, patio, pileta, parrilla,
            seguridad_24hs, ascensor, expensas_ars, baulera, sum, seguridad_tipo, camara,
            gym, lounge, laundry, precio_real_usd, precio_estimado_ia_usd, coordenadas_gps, fecha_publicacion,
            fichaprop_ruido, fichaprop_obras, fichaprop_subte, fichaprop_plazas, fichaprop_escuelas,
            fichaprop_comuna, fichaprop_resenas_cant
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
            $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35,
            $36, $37, $38, $39, $40, $41, $42
        )
        ON CONFLICT (id_propiedad) DO NOTHING;
    `;

    const { id_propiedad, link, p, precio_real_usd, precio_estimado_ia_usd, coordsFinales, fechaPublicacion, fp } = campos;

    const values = [
        id_propiedad,
        link,
        p.tipo_propiedad,
        (p.barrio_zona || 'Capital Federal').slice(0, 50),
        p.direccion ? p.direccion.slice(0, 50) : null,
        toNullableInt(p.ambientes) || 1,
        toNullableInt(p.dormitorios) || 1,
        toNullableInt(p.banos) || 1,
        toNullableInt(p.superficie_total_m2),
        toNullableInt(p.superficie_cubierta_m2),
        p.estado || 'Usado',
        toNullableInt(p.anios_de_antiguedad),
        toNullableInt(p.piso),
        p.orientacion || 'No especificada',
        p.disposicion || 'No especificada',
        Boolean(p.cochera),
        Boolean(p.balcon),
        Boolean(p.terraza),
        Boolean(p.patio),
        Boolean(p.pileta),
        Boolean(p.parrilla),
        Boolean(p.seguridad_24hs),
        Boolean(p.ascensor),
        toNullableInt(p.expensas_ars) || 0,
        Boolean(p.baulera),
        Boolean(p.sum),
        p.seguridad_tipo || 'Ninguno',
        Boolean(p.camara),
        Boolean(p.gym),
        Boolean(p.lounge),
        Boolean(p.laundry),
        toNullableInt(precio_real_usd),
        toNullableInt(precio_estimado_ia_usd),
        coordsFinales ? JSON.stringify(coordsFinales) : null,
        fechaPublicacion,
        fp?.ruido || null,
        fp?.obras || null,
        fp?.subte || null,
        fp?.plazas || null,
        fp?.escuelas || null,
        fp?.comuna || null,
        toNullableInt(fp?.resenas) || 0,
    ];

    await pool.query(query, values);
};

const procesarPropiedad = async (context, link, id_propiedad, indice, total) => {
    const detailPage = await context.newPage();

    try {
        let response = null;
        try {
            response = await detailPage.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch {
            console.warn(`[${indice}/${total}] ${id_propiedad}: timeout al abrir. Omitida.`);
            return false;
        }

        if (await esPaginaBloqueada(detailPage, response)) {
            console.warn(`[${indice}/${total}] ${id_propiedad}: bloqueo detectado en Zonaprop. Omitida.`);
            return false;
        }

        const cargadoOk = await detailPage.waitForFunction(() => {
            const el = document.querySelector('[data-qa="price"], [class*="Price"], [class*="price"]');
            return el && el.innerText && el.innerText.trim().length > 0;
        }, { timeout: 10000 }).catch(() => false);

        if (!cargadoOk) {
            console.warn(`[${indice}/${total}] ${id_propiedad}: no se pudo leer el precio en pantalla. Omitida.`);
            return false;
        }

        await detailPage.evaluate(async () => {
            window.scrollTo(0, document.body.scrollHeight / 2);
            await new Promise(r => setTimeout(r, 200));
        });

        const textoFechaNodo = await detailPage.evaluate(() => {
            const todos = Array.from(document.querySelectorAll('*'));
            const coincidencia = todos.find(n => n.children.length === 0 && /publicado\s+hace/i.test(n.innerText || ''));
            if (coincidencia) return coincidencia.innerText;
            const match = document.body.innerText.match(/publicado\s+hace\s+\d+\s*(?:día|días|dia|dias|mes|meses|año|años|ano|anos)/i);
            return match ? match[0] : '';
        });
        const fechaPublicacion = calcularFechaPublicacion(textoFechaNodo);

        const textoPestanias = await expandirPestanias(detailPage);
        let data = await detailPage.evaluate(extraerDatosDePagina, textoPestanias);

        if (!data.precioUSD) {
            await detailPage.waitForTimeout(800);
            data = await detailPage.evaluate(extraerDatosDePagina, textoPestanias);
        }

        const precio_real_usd = parsearPrecioUSD(data.precioUSD);
        if (!precio_real_usd) {
            console.warn(`[${indice}/${total}] ${id_propiedad}: precio no detectado (texto: "${data.precioUSD}"). Omitida.`);
            return false;
        }

        const propiedadData = construirPropiedadData(data);
        
        const fp = propiedadData.direccion ? await consultarFichaprop(context, propiedadData.direccion) : null;
        const resultadoIA = await estimarPrecioIA(propiedadData);
        const coordsFinales = await resolverCoordsFinales(data, resultadoIA, propiedadData);

        await guardarPropiedad({
            id_propiedad,
            link,
            p: propiedadData,
            precio_real_usd,
            precio_estimado_ia_usd: resultadoIA.precio_estimado_usd,
            coordsFinales,
            fechaPublicacion,
            fp,
        });

        console.log(`[${indice}/${total}] ${id_propiedad}: guardada (${precio_real_usd} USD)${fp ? ' + Fichaprop' : ''}.`);
        await delay(...CONFIG.DELAY_ENTRE_PROPIEDADES);
        return true;

    } catch (err) {
        console.error(`[${indice}/${total}] ${id_propiedad}: error (${err.message}).`);
        return false;
    } finally {
        await detailPage.close().catch(() => {});
    }
};

(async () => {
    console.log('Iniciando scraper...');

    let browser;
    let context;
    try {
        // Chromium se inicia desde Playwright: no hace falta abrir Chrome manualmente ni usar CDP.
        browser = await chromium.launch({ headless: CONFIG.HEADLESS });
        context = await browser.newContext({
            locale: 'es-AR',
            timezoneId: 'America/Argentina/Buenos_Aires',
            viewport: { width: 1366, height: 900 },
        });
        context.setDefaultTimeout(15000);
        console.log('[Chromium] Navegador iniciado por Playwright (sin proxy).');
    } catch (err) {
        console.error(`[Chromium] No se pudo iniciar el navegador: ${err.message}`);
        console.error('Si falta el navegador, ejecutá: npx playwright install chromium');
        await pool.end().catch(() => {});
        process.exit(1);
    }

    const page = await context.newPage();

    try {
        const links = await obtenerLinksDeListado(page);
        console.log(`${links.length} publicaciones únicas encontradas.`);

        if (links.length === 0) return;

        const { rows } = await pool.query('SELECT id_propiedad FROM propiedades');
        const idsProcesados = new Set(rows.map(r => r.id_propiedad));
        let nuevos = 0;

        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            const idMatch = link.match(/\-(\d+)\.html/);
            const id_propiedad = idMatch ? `zp-${idMatch[1]}` : null;
            if (!id_propiedad) continue;

            if (idsProcesados.has(id_propiedad)) {
                console.log(`[${i + 1}/${links.length}] ${id_propiedad}: ya existe. Omitida.`);
                continue;
            }

            const guardada = await procesarPropiedad(context, link, id_propiedad, i + 1, links.length);
            if (guardada) nuevos++;
        }

        console.log(`Finalizado. Nuevas propiedades guardadas: ${nuevos}`);

        if (nuevos > 0) {
            try {
                await fetch(`${CONFIG.IA_URL}/reentrenar`, { method: 'POST', headers: headersIA() });
            } catch {
                // opcional
            }
        }

    } catch (e) {
        console.error(`Error general: ${e.message}`);
    } finally {
        if (browser) await browser.close().catch(() => {});
        await pool.end().catch(() => {});
    }
})();