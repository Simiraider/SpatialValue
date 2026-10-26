import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { Pool } from '@neondatabase/serverless';

dotenv.config({ path: '.env.local' });
dotenv.config();

const CONFIG = {
    PAGINAS_MAXIMAS: 30,
    URL_BASE: 'https://www.zonaprop.com.ar/casas-venta-capital-federal.html',
    URL_PAGINA: (n) => `https://www.zonaprop.com.ar/casas-venta-capital-federal-pagina-${n}.html`,

    CDP_URL: process.env.CHROME_CDP_URL || 'http://127.0.0.1:9222',
    DRY_RUN: process.env.SCRAPER_DRY_RUN === 'true',
    MAX_PROPIEDADES: Math.max(0, Number.parseInt(process.env.SCRAPER_MAX_PROPIEDADES || (process.env.SCRAPER_DRY_RUN === 'true' ? '1' : '0'), 10) || 0),
    URL_PRUEBA: process.env.SCRAPER_URL_PRUEBA || '',

    IA_URL: process.env.IA_URL || 'http://127.0.0.1:8000',
    IA_API_KEY: process.env.INTERNAL_API_KEY || '',
    DB_URL: process.env.SpatialValueStorage_DATABASE_URL || process.env.DATABASE_URL || process.env.NEON_DATABASE_URL,

    NOMINATIM_URL: 'https://nominatim.openstreetmap.org/search',
    NOMINATIM_REVERSE_URL: 'https://nominatim.openstreetmap.org/reverse',
    NOMINATIM_USER_AGENT: 'SpatialValue-Scraper/2.0 (contacto@spatialvalue.com)',
    NOMINATIM_DELAY_MS: 1100,

    FICHAPROP_URL: 'https://fichaprop.ar',
    FICHAPROP_VARCHAR_MAX: 50,

    DELAY_ENTRE_PROPIEDADES: [1000, 2000],
    PESTANIAS_A_EXPANDIR: ['Características generales', 'Ambientes', 'Servicios', 'Instalaciones'],

    CLOUDFLARE_ESPERA_LISTADO_MS: 90000,
    CLOUDFLARE_ESPERA_DETALLE_MS: 45000,
};

if (!CONFIG.DB_URL) {
    console.error('No se encontró la variable de base de datos en .env ni .env.local');
    process.exit(1);
}

const pool = new Pool({ connectionString: CONFIG.DB_URL });

const toNullableInt = (val) => {
    if (val === null || val === undefined || val === '') return null;
    const num = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
    if (isNaN(num)) return null;
    return Math.round(num);
};
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
    const match = String(texto).match(/(?:\bUSD\b|U\$S|US\$)\s*([\d.,]+)/i);
    if (!match) return 0;

    let monto = match[1].trim();
    if (monto.includes('.') && monto.includes(',')) {
        if (monto.lastIndexOf(',') > monto.lastIndexOf('.')) monto = monto.replace(/\./g, '').replace(',', '.');
        else monto = monto.replace(/,/g, '');
    } else if (/[.,]\d{3}$/.test(monto)) {
        monto = monto.replace(/[.,]/g, '');
    } else {
        monto = monto.replace(',', '.');
    }
    const valor = Number(monto);
    return Number.isFinite(valor) && valor >= 100 && valor <= 20000000 ? Math.round(valor) : 0;
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

const normalizarDireccionFichaprop = (direccion) => {
    if (!direccion || esTituloNoDireccion(direccion)) return null;

    let dir = direccion.toLowerCase();
    dir = dir.split(',')[0];                  
    dir = dir.split(/\bentre\b/i)[0];        
    dir = dir.replace(/\bal\b/g, ' ');        
    dir = dir.replace(/\b(piso|pb|dto|dpto|depto|departamento|uf|torre|esq|esquina)\b.*$/, ' ');

    const ultimo = [...dir.matchAll(/\b\d{1,5}\b/g)].pop();
    if (!ultimo) return null;
    dir = dir.slice(0, ultimo.index + ultimo[0].length);

    const slug = dir
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\bav(?:da|d)?\b\.?/g, 'avenida')
        .replace(/\bpje\b\.?/g, 'pasaje')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');

    return slug.length > 2 ? slug : null;
};

const candidatosSlugFichaprop = (direccion) => {
    const base = normalizarDireccionFichaprop(direccion);
    if (!base) return [];
    const sinPrefijo = base.replace(/^(avenida|pasaje|calle)-/, '');
    return [...new Set([base, sinPrefijo])].filter(sl => sl.length > 2);
};

const delay = (min, max) => new Promise(r => setTimeout(r, min + Math.random() * (max - min)));

const esCoordenadaCABA = (lat, lng) => {
    if (!lat || !lng) return false;
    return (lat >= -34.7100 && lat <= -34.5000) && (lng >= -58.5500 && lng <= -58.3200);
};

const esCentroPorDefecto = (c) => !!c && Math.abs(Number(c.lat) + 34.6037) < 0.0005 && Math.abs(Number(c.lng) + 58.3816) < 0.0005;

const limpiarDireccionGeocode = (direccion) => {
    if (!direccion || esTituloNoDireccion(direccion)) return '';
    return direccion
        .replace(/\bal\b/gi, ' ')
        .replace(/\bavda?\.?\b/gi, 'Avenida ')
        .split(/\bentre\b|\.|,/i)[0]
        .replace(/\s+/g, ' ')
        .trim();
};

const geocodeCache = new Map();

const BARRIOS_CABA = new Set([
    'agronomia', 'almagro', 'balvanera', 'barracas', 'belgrano', 'boedo', 'caballito',
    'chacarita', 'coghlan', 'colegiales', 'constitucion', 'flores', 'floresta', 'la boca',
    'liniers', 'mataderos', 'monte castro', 'monserrat', 'montserrat', 'nueva pompeya', 'nunez', 'palermo',
    'parque avellaneda', 'parque chacabuco', 'parque chas', 'parque patricios', 'paternal',
    'puerto madero', 'recoleta', 'retiro', 'saavedra', 'san cristobal', 'san nicolas', 'san telmo',
    'velez sarsfield', 'versalles', 'villa crespo', 'villa del parque', 'villa devoto',
    'villa general mitre', 'villa lugano', 'villa luro', 'villa ortuzar', 'villa pueyrredon',
    'villa real', 'villa riachuelo', 'villa santa rita', 'villa soldati', 'villa urquiza'
]);

const normalizarTexto = (v) => String(v ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').toLowerCase().trim();

const barrioDesdeOSM = (address) => {
    if (!address) return null;
    const candidatos = [address.suburb, address.neighbourhood, address.quarter, address.city_district, address.borough]
        .filter(v => typeof v === 'string' && v.trim())
        .map(v => v.trim().replace(/^barrio\s+/i, ''));
    return candidatos.find(v => BARRIOS_CABA.has(normalizarTexto(v))) || null;
};

const consultarNominatim = async (url) => {
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': CONFIG.NOMINATIM_USER_AGENT,
                'Accept-Language': 'es-AR,es;q=0.9'
            }
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    } finally {
        await new Promise(r => setTimeout(r, CONFIG.NOMINATIM_DELAY_MS));
    }
};
const geocodeDireccion = async (queryTexto) => {
    if (!queryTexto) return null;
    if (geocodeCache.has(queryTexto)) return geocodeCache.get(queryTexto);

    const data = await consultarNominatim(
        `${CONFIG.NOMINATIM_URL}?format=json&limit=1&addressdetails=1&countrycodes=ar&q=${encodeURIComponent(queryTexto)}`
    );
    if (!data || data.length === 0) return null;

    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    if (!esCoordenadaCABA(lat, lng)) return null;

    const resultado = { lat, lng, barrio: barrioDesdeOSM(data[0].address) };
    geocodeCache.set(queryTexto, resultado);
    return resultado;
};

const reverseNominatim = async (lat, lng) => {
    const clave = `revraw:${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
    if (geocodeCache.has(clave)) return geocodeCache.get(clave);

    const data = await consultarNominatim(
        `${CONFIG.NOMINATIM_REVERSE_URL}?format=json&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`
    );
    geocodeCache.set(clave, data);
    return data;
};

const reverseGeocode = async (lat, lng) => barrioDesdeOSM((await reverseNominatim(lat, lng))?.address);

const direccionDesdeCoords = async (lat, lng) => {
    const a = (await reverseNominatim(lat, lng))?.address;
    if (!a?.road || !a?.house_number) return null;
    return `${a.road} ${a.house_number}`;
};

const resolverCoordenadas = async (direccionTexto, barrioZona) => {
    const dirLimpia = limpiarDireccionGeocode(direccionTexto);

    if (dirLimpia && dirLimpia.length > 3) {
        const coordsExactas = await geocodeDireccion(`${dirLimpia}, Capital Federal, Buenos Aires, Argentina`);
        if (coordsExactas) return coordsExactas;

        const coordsCABA = await geocodeDireccion(`${dirLimpia}, CABA, Argentina`);
        if (coordsCABA) return coordsCABA;
    }

    if (barrioZona && !/^(capital federal|caba|ciudad autonoma de buenos aires)$/i.test(barrioZona.trim())) {
        const barrioLimpio = barrioZona.split(',')[0].trim();
        const coordsBarrio = await geocodeDireccion(`${barrioLimpio}, Capital Federal, Buenos Aires, Argentina`);
        if (coordsBarrio) return coordsBarrio;
    }

    return null; 
};

const extraerFichaDePagina = () => {
    const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const textosAnchor = (hash) => Array.from(document.querySelectorAll(`a[href="${hash}"]`))
        .map(a => limpiar(a.innerText || a.textContent))
        .filter(Boolean);

    const ruido = textosAnchor('#ruido')[0] || null;
    const obras = textosAnchor('#obras')[0] || null;
    const entorno = textosAnchor('#entorno');
    const experiencias = textosAnchor('#experiencias')[0] || '';

    if (!ruido && !obras && entorno.length === 0) return null; // página sin ficha

    const esLineaSubte = (t) => /l[ií]nea|subte/i.test(t);
    const subte = entorno.find(esLineaSubte) || null;
    const plazas = entorno.find(t => !esLineaSubte(t) && /plaza|parque/i.test(t)) || null;
    const escuelas = entorno.find(t => !esLineaSubte(t) && /escuela|jard[ií]n/i.test(t)) || null;

    const cuerpo = document.body ? document.body.innerText : '';
    const matchComuna = cuerpo.match(/Comuna\s+(\d{1,2})/i);
    const matchResenas = (experiencias || cuerpo).match(/(\d+)\s*rese(?:ñ|n)as?/i);
    const linkBarrio = document.querySelector('a[href^="/barrio/"]');

    return {
        ruido,
        obras,
        subte,
        plazas,
        escuelas,
        comuna: matchComuna ? `Comuna ${matchComuna[1]}` : null,
        resenas: matchResenas ? parseInt(matchResenas[1], 10) : 0,
        barrio: linkBarrio ? limpiar(linkBarrio.innerText || linkBarrio.textContent) : null,
    };
};

const resumenTextoPagina = (pageFP) => pageFP
    .evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 160))
    .catch(() => '');

const leerFichaActual = async (pageFP) => {
    await pageFP.waitForSelector('a[href="#ruido"], a[href="#entorno"], a[href="#obras"]', { timeout: 6000 }).catch(() => {});
    return pageFP.evaluate(extraerFichaDePagina);
};

const abrirFichaPorSlug = async (pageFP, slug) => {
    const url = `${CONFIG.FICHAPROP_URL}/edificio/${slug}`;
    const response = await pageFP.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
    if (!response || response.status() !== 200) {
        console.log(`[Fichaprop] ${url} respondió ${response ? response.status() : 'sin respuesta'}.`);
        return null;
    }
    return leerFichaActual(pageFP);
};
const buscarFichaEnSitio = async (pageFP, direccion) => {
    const consulta = String(direccion).split(/,|\bentre\b/i)[0].replace(/\bal\b/gi, ' ').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
    if (!consulta) return null;
    try {
        await pageFP.goto(CONFIG.FICHAPROP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const input = pageFP.locator('input[type="text"], input[type="search"], input:not([type])').first();
        await input.waitFor({ timeout: 5000 });
        await input.fill(consulta);
        await pageFP.waitForTimeout(1200);
        try {
            await Promise.all([pageFP.waitForURL(/\/edificio\//, { timeout: 8000 }), input.press('Enter')]);
        } catch {
            await Promise.all([
                pageFP.waitForURL(/\/edificio\//, { timeout: 8000 }),
                pageFP.locator('button:has-text("Buscar")').first().click(),
            ]);
        }
        const ficha = await leerFichaActual(pageFP);
        if (ficha) {
            console.log(`[Fichaprop] Ficha encontrada con el buscador del sitio: ${pageFP.url()}`);
        } else {
            const titulo = await pageFP.title().catch(() => '');
            console.log(`[Fichaprop] El buscador llevó a ${pageFP.url()} pero la página no tiene ficha (título: "${titulo}"; texto: "${await resumenTextoPagina(pageFP)}").`);
        }
        return ficha;
    } catch (e) {
        console.log(`[Fichaprop] El buscador del sitio no devolvió una ficha para "${consulta}" (${e.message.split('\n')[0]}). Texto en pantalla: "${await resumenTextoPagina(pageFP)}"`);
        return null;
    }
};

const consultarFichaprop = async (context, direccion) => {
    if (!direccion) return null;

    const slugs = candidatosSlugFichaprop(direccion);
    const pageFP = await context.newPage();
    try {
        for (const slug of slugs) {
            const ficha = await abrirFichaPorSlug(pageFP, slug);
            if (ficha) {
                console.log(`[Fichaprop] Ficha encontrada: ${CONFIG.FICHAPROP_URL}/edificio/${slug}`);
                return ficha;
            }
        }
        if (slugs.length === 0) console.log(`[Fichaprop] "${direccion}" no tiene calle y altura; se prueba con el buscador del sitio.`);

        const ficha = await buscarFichaEnSitio(pageFP, direccion);
        if (!ficha) console.log(`[Fichaprop] Sin ficha para "${direccion}".`);
        return ficha;
    } catch (e) {
        console.log(`[Fichaprop] Error consultando "${direccion}": ${e.message}`);
        return null;
    } finally {
        await pageFP.close().catch(() => {});
    }
};

const esperarDesafioCloudflare = async (page, maxMs = 90000) => {
    const enDesafio = async () => {
        const titulo = await page.title().catch(() => '');
        return /just a moment|un momento|attention required|cloudflare/i.test(titulo) || page.url().includes('__cf_chl');
    };

    if (!(await enDesafio())) return true;

    console.warn('[Cloudflare] Desafío detectado. Esperando... (si aparece un checkbox, resolvelo a mano en la ventana de Chrome)');
    const inicio = Date.now();
    while (Date.now() - inicio < maxMs) {
        await page.waitForTimeout(2000);
        if (!(await enDesafio())) {
            console.log('[Cloudflare] Desafío superado.');
            await page.waitForTimeout(1000);
            return true;
        }
    }
    return false;
};

const obtenerLinksDeListado = async (page) => {
    const linksTotales = [];

    for (let pagina = 1; pagina <= CONFIG.PAGINAS_MAXIMAS; pagina++) {
        const urlPagina = pagina === 1 ? CONFIG.URL_BASE : CONFIG.URL_PAGINA(pagina);
        console.log(`\n[Listado] Página ${pagina}/${CONFIG.PAGINAS_MAXIMAS}: ${urlPagina}`);

        try {
            const response = await page.goto(urlPagina, { waitUntil: 'domcontentloaded', timeout: 60000 });
            console.log(`[Listado] HTTP ${response?.status() ?? 'sin respuesta'} | URL final: ${page.url()}`);

            if (!(await esperarDesafioCloudflare(page, CONFIG.CLOUDFLARE_ESPERA_LISTADO_MS))) {
                console.warn('[Listado] Cloudflare no se resolvió a tiempo. Se detiene la paginación.');
                break;
            }

            console.log(`[Listado] Título: ${await page.title().catch(() => '(sin título)')}`);

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
            }
            linksTotales.push(...linksPagina);
            await page.waitForTimeout(900);
        } catch (err) {
            console.warn(`[Listado] Página ${pagina}: error al cargar: ${err.message}`);
        }
    }

    return [...new Set(linksTotales)];
};

const esPaginaBloqueada = async (detailPage) => {
    return !(await esperarDesafioCloudflare(detailPage, CONFIG.CLOUDFLARE_ESPERA_DETALLE_MS));
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
    let ambientesState = null;
    let dormitoriosState = null;
    let banosState = null;
    let antiguedadState = null;
    let luminosidadState = null;
    let tipoState = null;
    const diagnosticoState = { scriptEncontrado: false, error: null, postingLocation: null };

    const normalizarCaracteristica = (valor) => String(valor ?? '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/m²/gi, 'm2').replace(/\s+/g, ' ').toLowerCase().trim();

    const numeroCapturado = (captura) => {
        if (!captura) return null;
        let numero = String(captura).trim();
        if (/^\d{1,3}(?:[.,]\d{3})+$/.test(numero)) numero = numero.replace(/[.,]/g, '');
        else if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(numero)) numero = numero.replace(/,/g, '');
        else numero = numero.replace(',', '.');
        const n = Number(numero);
        return Number.isFinite(n) ? Math.round(n) : null;
    };
    const extraerNumeroCampo = (texto, campo) => {
        const t = normalizarCaracteristica(texto);
        const patrones = {
            ambientes: [/\bambientes?\s*[:=\-]?\s*(\d{1,2})\b/i, /\b(\d{1,2})\s*(?:ambientes?|amb)\b/i],
            dormitorios: [/\b(?:dormitorios?|habitaciones?)\s*[:=\-]?\s*(\d{1,2})\b/i, /\b(\d{1,2})\s*(?:dormitorios?|dorms?|habitaciones?|hab)\b/i],
            banos: [/\bbanos?\s*[:=\-]?\s*(\d{1,2})\b/i, /\b(\d{1,2})\s*banos?\b/i],
            superficie_total: [/(?:superficie\s+total|sup\.?\s*total|m2\s*totales?)\s*[:=\-]?\s*([\d.,]+)/i, /([\d.,]+)\s*m2\s*(?:totales|total|tot\b)/i],
            superficie_cubierta: [/(?:superficie\s+cubierta|sup\.?\s*cubierta|m2\s*cubiertos?)\s*[:=\-]?\s*([\d.,]+)/i, /([\d.,]+)\s*m2\s*(?:cubiertos?|cub\b)/i],
            antiguedad: [/\bantiguedad\s*(?:de\s+)?[:=\-]?\s*(\d{1,3})\b/i, /\b(\d{1,3})\s+anos?\s+de\s+antiguedad\b/i, /^(\d{1,3})\s*anos?$/i],
        };
        for (const patron of patrones[campo] || []) {
            const m = t.match(patron);
            if (m) return numeroCapturado(m[1]);
        }
        return null;
    };
    const extraerLuminosidad = (texto) => {
        const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
        const capitalizar = (v) => v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
        let m = t.match(/luminosidad\s*[:=\-]?\s*((?:muy |poco )?luminos[oa]s?|oscur[oa]s?|normal|regular)/i);
        if (m) return capitalizar(m[1].trim());
        m = t.match(/^((?:muy |poco )?luminos[oa]s?)$/i);
        if (m) return capitalizar(m[1].trim());
        return null;
    };

    const aplicarTextoCaracteristicas = (texto) => {
        const normalizado = normalizarCaracteristica(texto);
        if (ambientesState === null) ambientesState = extraerNumeroCampo(texto, 'ambientes');
        if (dormitoriosState === null) dormitoriosState = extraerNumeroCampo(texto, 'dormitorios');
        if (banosState === null) banosState = extraerNumeroCampo(texto, 'banos');
        if (supTotalState === null) supTotalState = extraerNumeroCampo(texto, 'superficie_total');
        if (supCubiertaState === null) supCubiertaState = extraerNumeroCampo(texto, 'superficie_cubierta');
        if (antiguedadState === null) {
            if (/\ba estrenar\b|\bestrenar\b/.test(normalizado)) antiguedadState = 0;
            else antiguedadState = extraerNumeroCampo(texto, 'antiguedad');
        }
        if (luminosidadState === null) luminosidadState = extraerLuminosidad(texto);
    };

    const BARRIOS_CABA = new Set([
        'agronomia', 'almagro', 'balvanera', 'barracas', 'belgrano', 'boedo', 'caballito',
        'chacarita', 'coghlan', 'colegiales', 'constitucion', 'flores', 'floresta', 'la boca',
        'liniers', 'mataderos', 'monte castro', 'monserrat', 'nueva pompeya', 'nunez', 'palermo',
        'parque avellaneda', 'parque chacabuco', 'parque chas', 'parque patricios', 'paternal',
        'puerto madero', 'recoleta', 'retiro', 'saavedra', 'san cristobal', 'san nicolas', 'san telmo',
        'velez sarsfield', 'versalles', 'villa crespo', 'villa del parque', 'villa devoto',
        'villa general mitre', 'villa lugano', 'villa luro', 'villa ortuzar', 'villa pueyrredon',
        'villa real', 'villa riachuelo', 'villa santa rita', 'villa soldati', 'villa urquiza'
    ]);

    try {
        const scripts = Array.from(document.querySelectorAll('script'));
        const scriptState = scripts.find(s => s.textContent && s.textContent.includes('__INITIAL_STATE__'));
        if (scriptState) {
            diagnosticoState.scriptEncontrado = true;
            const idxMarca = scriptState.textContent.indexOf('__INITIAL_STATE__');
            const idxLlave = scriptState.textContent.indexOf('{', idxMarca);
            if (idxLlave !== -1) {
                const jsonTexto = extraerObjetoBalanceado(scriptState.textContent, idxLlave);
                if (jsonTexto) {
                    const state = JSON.parse(jsonTexto);
                    const posting = state.posting || (state.postings && state.postings[0]);
                    if (posting) {
                        const postingLocation = posting.postingLocation || {};
                        diagnosticoState.postingLocation = JSON.stringify(postingLocation).slice(0, 600);

                        const geo = postingLocation.postingGeolocation?.geolocation
                            || postingLocation.geolocation
                            || posting.postingGeolocation?.geolocation
                            || posting.geolocation
                            || {};
                        latitudState = Number(geo.latitude ?? geo.lat) || null;
                        longitudState = Number(geo.longitude ?? geo.lng ?? geo.lon) || null;

                        const textoDireccion = (v) => {
                            if (!v) return null;
                            if (typeof v === 'string') return v;
                            if (typeof v === 'object') return textoDireccion(v.name ?? v.address ?? v.value ?? v.label ?? v.text ?? null);
                            return null;
                        };
                        direccionState = [postingLocation.address, postingLocation.realAddress, posting.address, posting.realAddress]
                            .map(textoDireccion)
                            .find(t => t && t.trim() && !esTituloOMedida(t)) || null;

                        const candidatosBarrio = [
                            postingLocation.zone?.name,
                            postingLocation.location?.name,
                            postingLocation.location?.parent?.name,
                            postingLocation.location?.parent?.parent?.name,
                            postingLocation.parent?.name,
                        ].filter(v => typeof v === 'string' && v.trim());
                        const barriosNormalizados = candidatosBarrio.map(v => {
                            const limpio = v.trim().split(',')[0].replace(/^barrio\s+de\s+/i, '').trim();
                            return { original: limpio, normalizado: normalizarCaracteristica(limpio) };
                        });
                        const barrioConocido = barriosNormalizados.find(v => BARRIOS_CABA.has(v.normalizado));
                        const barrioNoGenerico = barriosNormalizados.find(v => !/^(capital federal|caba|ciudad autonoma de buenos aires|buenos aires|argentina)$/.test(v.normalizado));
                        barrioState = barrioConocido?.original || barrioNoGenerico?.original || null;

                        const tipoCandidato = posting.realEstateType?.name || posting.propertyType?.name || posting.type?.name || posting.propertyType || posting.realEstateType || null;
                        if (typeof tipoCandidato === 'string') tipoState = tipoCandidato;

                        const priceObj = posting.priceOperationTypes?.[0]?.prices?.[0];
                        if (priceObj) precioState = `${priceObj.currency || ''} ${priceObj.amount || ''}`;

                        const visitarFeature = (nodo, etiquetaPadre = '') => {
                            if (Array.isArray(nodo)) {
                                nodo.forEach(item => visitarFeature(item, etiquetaPadre));
                                return;
                            }
                            if (!nodo || typeof nodo !== 'object') {
                                if (etiquetaPadre && nodo !== null && nodo !== undefined) aplicarTextoCaracteristicas(`${etiquetaPadre}: ${nodo}`);
                                return;
                            }
                            const etiqueta = nodo.label || nodo.name || nodo.title || nodo.key || etiquetaPadre;
                            const valor = nodo.value ?? nodo.valueText ?? nodo.valueName ?? nodo.text ?? nodo.description;
                            if (etiqueta && valor !== null && valor !== undefined && typeof valor !== 'object') {
                                aplicarTextoCaracteristicas(`${etiqueta}: ${valor}`);
                            }
                            for (const [clave, hijo] of Object.entries(nodo)) {
                                if (hijo && typeof hijo === 'object') visitarFeature(hijo, clave);
                                else if (hijo !== null && hijo !== undefined && ['string', 'number'].includes(typeof hijo)) {
                                    aplicarTextoCaracteristicas(`${clave}: ${hijo}`);
                                }
                            }
                        };
                        visitarFeature(posting.mainFeatures || {});
                        visitarFeature(posting.generalFeatures || {});
                        visitarFeature(posting.sectionFeatures || {});
                        diagnosticoState.features = JSON.stringify({ main: posting.mainFeatures, general: posting.generalFeatures, section: posting.sectionFeatures }).slice(0, 2500);
                    }
                }
            }
        }
    } catch (e) {
        diagnosticoState.error = String((e && e.message) || e);
    }

    const textoCompleto = (document.body ? document.body.innerText : '') + ' ' + (textoAdicionalTabs || '');
    const textoLower = textoCompleto.toLowerCase();

    const esEnConstruccion = /en construcci[oó]n|en pozo|emprendimiento|al pozo/.test(textoLower);

    let direccion = direccionState;
    if (!direccion) {
        const elementosDir = document.querySelectorAll(
            '[data-qa="section-location-property"] h2, [data-qa="section-location-property"] h3, [data-qa="section-location-property"] h4, ' +
            '[class*="section-location"] h2, [class*="section-location"] h4, [class*="LocationTitle"], [class*="location-title"], [class*="title-location"]'
        );
        for (const el of elementosDir) {
            const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            if (txt && txt.length <= 120 && !esTituloOMedida(txt)) { direccion = txt; break; }
        }
    }
    if (!direccion) {
        for (const sc of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
                const j = JSON.parse(sc.textContent);
                for (const nodo of (Array.isArray(j) ? j : [j])) {
                    const calle = nodo?.address?.streetAddress || nodo?.itemOffered?.address?.streetAddress;
                    if (typeof calle === 'string' && calle.trim() && !esTituloOMedida(calle)) { direccion = calle.trim(); break; }
                }
            } catch {}
            if (direccion) break;
        }
    }
    if (!direccion) {
        const lineas = (document.body?.innerText || '').split(/\n+/).map(l => l.replace(/\s+/g, ' ').trim());
        const idx = lineas.findIndex(l => /^ubicaci[oó]n$/i.test(l));
        if (idx !== -1) {
            const hallada = lineas.slice(idx + 1, idx + 6)
                .find(l => l.length >= 5 && l.length <= 100 && /[A-Za-zÁÉÍÓÚáéíóúñÑ.]\s+\d{1,5}\b/.test(l) && !esTituloOMedida(l) && !/\$|usd|expensas/i.test(l));
            if (hallada) direccion = hallada;
        }
    }

    const barrio_zona = barrioState || 'Capital Federal';

    let superficie_total = supTotalState;
    let superficie_cubierta = supCubiertaState;
    let ambientes = ambientesState;
    let banos = banosState;
    let dormitorios = dormitoriosState;
    let anios_de_antiguedad = antiguedadState;
    let luminosidad = luminosidadState;
    let disposicion = 'No especificada';
    let orientacion = 'No especificada';

    const featureNodes = Array.from(document.querySelectorAll(
        '[class*="icon-feature"], [class*="section-icon-features"] li, [data-qa="main-features"] > div, [class*="MainFeatures"] > div, [class*="feature-item"]'
    ));

    const textosCaracteristicas = [];
    const aplicarCampoDOM = (texto, htmlNodo = '') => {
        if (!texto || texto.length > 180) return;
        textosCaracteristicas.push(texto);
        if (superficie_total === null) superficie_total = extraerNumeroCampo(texto, 'superficie_total');
        if (superficie_cubierta === null) superficie_cubierta = extraerNumeroCampo(texto, 'superficie_cubierta');
        if (ambientes === null) ambientes = extraerNumeroCampo(texto, 'ambientes');
        if (banos === null) banos = extraerNumeroCampo(texto, 'banos');
        if (dormitorios === null) dormitorios = extraerNumeroCampo(texto, 'dormitorios');
        if (anios_de_antiguedad === null) {
            const normalizado = normalizarCaracteristica(texto);
            if (/\ba estrenar\b|\bestrenar\b/.test(normalizado)) anios_de_antiguedad = 0;
            else anios_de_antiguedad = extraerNumeroCampo(texto, 'antiguedad');
        }
        // Zonaprop suele mostrar "50 años" con un ícono (clase icon-antiguedad) y sin la palabra "antigüedad".
        if (anios_de_antiguedad === null && /antiguedad/i.test(htmlNodo)) {
            const n = texto.match(/\b(\d{1,3})\b/);
            if (n) anios_de_antiguedad = parseInt(n[1], 10);
            else if (/estrenar/i.test(texto)) anios_de_antiguedad = 0;
        }
        if (luminosidad === null) {
            luminosidad = extraerLuminosidad(texto);
            if (luminosidad === null && /luminos/i.test(htmlNodo) && /^[A-Za-zÁÉÍÓÚáéíóúñÑ ]{3,30}$/.test(texto)) {
                luminosidad = texto.charAt(0).toUpperCase() + texto.slice(1).toLowerCase();
            }
        }
        const txtNormalizado = normalizarCaracteristica(texto);
        if (txtNormalizado === 'frente') disposicion = 'Frente';
        if (txtNormalizado === 'contrafrente') disposicion = 'Contrafrente';
        const orientacionMatch = texto.trim().toUpperCase().match(/^(N|S|E|O|NE|NO|SE|SO)$/);
        if (orientacionMatch) orientacion = orientacionMatch[1];
    };

    featureNodes.forEach(node => {
        aplicarCampoDOM((node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(), (node.outerHTML || '').slice(0, 600));
    });

    // Usar líneas individuales permite extraer "3 baños" sin tomar el 400 de "400 m²".
    const lineasCandidatas = textoCompleto.split(/\n+/)
        .map(linea => linea.replace(/\s+/g, ' ').trim())
        .filter(linea => linea && linea.length <= 180 && /m²|m2|ambientes?|baños?|banos?|dormitorios?|\bdorms?\b|\bamb\b|habitaciones?|antigüedad|antiguedad|estrenar|frente|contrafrente|luminos|^\d{1,3}\s*a[ñn]os?$/i.test(linea));
    lineasCandidatas.forEach(linea => aplicarCampoDOM(linea));

    if (superficie_total === null) {
        for (const linea of lineasCandidatas) {
            const valor = extraerNumeroCampo(linea, 'superficie_total');
            if (valor !== null) { superficie_total = valor; break; }
        }
    }
    if (superficie_cubierta === null) {
        for (const linea of lineasCandidatas) {
            const valor = extraerNumeroCampo(linea, 'superficie_cubierta');
            if (valor !== null) { superficie_cubierta = valor; break; }
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

    const tituloPrincipal = (document.querySelector('h1')?.innerText || document.title || '').trim();
    const textoTipo = normalizarCaracteristica(`${tipoState || ''} ${tituloPrincipal}`);
    let tipo_propiedad = null;
    if (/\bph\b/.test(textoTipo)) tipo_propiedad = 'PH';
    else if (/\bcasa(s)?\b/.test(textoTipo)) tipo_propiedad = 'Casa';
    else if (/\bdepartamento(s)?\b|\bdepto(s)?\b/.test(textoTipo)) tipo_propiedad = 'Departamento';
    else if (tipoState) tipo_propiedad = String(tipoState).trim().slice(0, 40);
    else tipo_propiedad = 'Casa'; // La búsqueda de origen está limitada a casas en venta de CABA.

    const barrio_confirmado = Boolean(barrioState && BARRIOS_CABA.has(normalizarCaracteristica(barrioState)));
    const diagnosticoCaracteristicas = [...new Set([...textosCaracteristicas, ...lineasCandidatas])]
        .filter(t => /m²|m2|ambientes?|baños?|banos?|dormitorios?|\bdorms?\b|\bamb\b|habitaciones?|antigüedad|antiguedad|estrenar|luminos|^\d{1,3}\s*a[ñn]os?$/i.test(t))
        .slice(0, 40);

    return {
        textoLower,
        direccion,
        barrio_zona,
        barrio_confirmado,
        tipo_propiedad,
        diagnosticoCaracteristicas,
        diagnosticoState,
        precioUSD,
        expensas,
        superficie_total,
        superficie_cubierta,
        dormitorios,
        banos,
        ambientes,
        anios_de_antiguedad,
        luminosidad,
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

    let dirFinal = data.direccion
        ? data.direccion.replace(/\s*,\s*(capital federal|caba|ciudad aut[oó]noma.*)\s*$/i, '').trim().replace(/[.,\s]+$/, '')
        : null;
    if (dirFinal && esTituloNoDireccion(dirFinal)) dirFinal = null;
    if (dirFinal && dirFinal.length > 50) dirFinal = dirFinal.slice(0, 50).trim();

    return {
        tipo_propiedad: data.tipo_propiedad,
        barrio_zona: (data.barrio_zona || 'Capital Federal').trim().slice(0, 50),
        direccion: dirFinal,
        latitud: data.latitud ?? null,
        longitud: data.longitud ?? null,
        ambientes: data.ambientes ?? null,
        dormitorios: data.dormitorios ?? null,
        banos: data.banos ?? null,
        superficie_total_m2: data.superficie_total || null,
        superficie_cubierta_m2: data.superficie_cubierta || null,
        estado: estadoFinal,
        anios_de_antiguedad: data.anios_de_antiguedad,
        luminosidad: data.luminosidad ?? null,
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

// Nunca descarta la publicación: un dato faltante queda en null y un dato absurdo
// (fuera de rango) también se pasa a null con un aviso.
const sanearDatosExtraidos = (data) => {
    const avisos = [];
    const limpiar = (campo, minimo, maximo) => {
        const valor = data[campo];
        if (valor === null || valor === undefined || valor === '') { data[campo] = null; return; }
        const n = Number(valor);
        if (!Number.isInteger(n) || n < minimo || n > maximo) {
            avisos.push(`${campo}=${valor} fuera de rango (${minimo}-${maximo}); se guarda como null`);
            data[campo] = null;
        }
    };
    limpiar('ambientes', 1, 30);
    limpiar('dormitorios', 0, 30);
    limpiar('banos', 0, 30);
    limpiar('superficie_total', 10, 50000);
    limpiar('superficie_cubierta', 10, 50000);
    limpiar('anios_de_antiguedad', 0, 150);

    if (data.superficie_total && data.superficie_cubierta && data.superficie_cubierta > data.superficie_total) {
        avisos.push(`superficie cubierta (${data.superficie_cubierta}) mayor que la total (${data.superficie_total}); es inconsistente, cubierta se guarda como null`);
        data.superficie_cubierta = null;
    }
    return avisos;
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

// Resuelve coordenadas y barrio. Si Zonaprop no confirmó el barrio, se obtiene
// geocodificando la dirección en OpenStreetMap (y por coordenadas como respaldo).
const resolverUbicacionFinal = async (data, propiedadData) => {
    let coords = null;
    if (esCoordenadaCABA(data.latitud, data.longitud) && !esCentroPorDefecto({ lat: data.latitud, lng: data.longitud })) {
        coords = { lat: data.latitud, lng: data.longitud };
    }

    let barrio = data.barrio_confirmado ? propiedadData.barrio_zona : null;

    let geo = null;
    if (!coords || !barrio) {
        geo = await resolverCoordenadas(propiedadData.direccion, propiedadData.barrio_zona);
    }
    if (!coords && geo) coords = { lat: geo.lat, lng: geo.lng };
    if (!barrio && geo?.barrio) barrio = geo.barrio;
    if (!barrio && coords) barrio = await reverseGeocode(coords.lat, coords.lng);

    return { coords, barrio };
};

const recortarVarchar = (valor) => (valor ? String(valor).slice(0, CONFIG.FICHAPROP_VARCHAR_MAX).trim() : null);

const guardarPropiedad = async (campos) => {
    const query = `
        INSERT INTO propiedades (
            id_propiedad, url, tipo_propiedad, barrio_zona, direccion, ambientes, dormitorios, banos,
            superficie_total_m2, superficie_cubierta_m2, estado, anios_de_antiguedad, piso,
            orientacion, disposicion, cochera, balcon, terraza, patio, pileta, parrilla,
            seguridad_24hs, ascensor, expensas_ars, baulera, sum, seguridad_tipo, camara,
            gym, lounge, laundry, precio_real_usd, precio_estimado_ia_usd, coordenadas_gps, fecha_publicacion,
            fichaprop_ruido, fichaprop_obras, fichaprop_subte, fichaprop_plazas, fichaprop_escuelas,
            fichaprop_comuna, fichaprop_resenas_cant, luminosidad
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
            $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35,
            $36, $37, $38, $39, $40, $41, $42, $43
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
        toNullableInt(p.ambientes),
        toNullableInt(p.dormitorios),
        toNullableInt(p.banos),
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
        recortarVarchar(fp?.obras),
        recortarVarchar(fp?.subte),
        recortarVarchar(fp?.plazas),
        recortarVarchar(fp?.escuelas),
        fp?.comuna || null,
        toNullableInt(fp?.resenas) || 0,
        p.luminosidad ? String(p.luminosidad).slice(0, 50) : null,
    ];

    try {
        await pool.query(query, values);
    } catch (err) {
        // Si la columna luminosidad no acepta el valor (tipo o largo), se reintenta sin ese dato.
        const idxLum = values.length - 1;
        if (values[idxLum] !== null && ['22P02', '22001', '42804'].includes(err.code)) {
            console.warn(`[DB] ${id_propiedad}: luminosidad "${values[idxLum]}" rechazada (${err.message}); se reintenta con luminosidad = null.`);
            values[idxLum] = null;
            await pool.query(query, values);
        } else {
            throw err;
        }
    }
};

const procesarPropiedad = async (context, link, id_propiedad, indice, total) => {
    const detailPage = await context.newPage();

    try {
        try {
            await detailPage.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch {
            console.warn(`[${indice}/${total}] ${id_propiedad}: timeout al abrir. Omitida.`);
            return false;
        }

        if (await esPaginaBloqueada(detailPage)) {
            console.warn(`[${indice}/${total}] ${id_propiedad}: bloqueo de Cloudflare no resuelto. Omitida.`);
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
            console.warn(`[${indice}/${total}] ${id_propiedad}: precio en USD no verificado (texto: "${data.precioUSD}"). Omitida para no confundir ARS con USD.`);
            if (CONFIG.DRY_RUN) console.log('[DIAGNOSTICO_PRECIO]', JSON.stringify({ id_propiedad, link, precioDetectado: data.precioUSD, candidatos: data.diagnosticoCaracteristicas }, null, 2));
            return false;
        }

        const avisosDatos = sanearDatosExtraidos(data);
        if (avisosDatos.length) console.warn(`[${indice}/${total}] ${id_propiedad}: ${avisosDatos.join('; ')}`);

        const propiedadData = construirPropiedadData(data);

        // Barrio y coordenadas (barrio por dirección en OpenStreetMap si Zonaprop no lo informó)
        const ubicacion = await resolverUbicacionFinal(data, propiedadData);
        if (ubicacion.barrio) {
            propiedadData.barrio_zona = ubicacion.barrio.slice(0, 50);
        } else if (!data.barrio_confirmado) {
            console.warn(`[${indice}/${total}] ${id_propiedad}: no se pudo determinar el barrio; queda "${propiedadData.barrio_zona}".`);
        }

        const faltantes = ['direccion', 'ambientes', 'dormitorios', 'banos', 'superficie_total_m2', 'superficie_cubierta_m2', 'anios_de_antiguedad', 'luminosidad']
            .filter(campo => propiedadData[campo] === null || propiedadData[campo] === undefined);
        if (faltantes.length) console.log(`[${indice}/${total}] ${id_propiedad}: sin dato (se guarda null): ${faltantes.join(', ')}`);

        // Ubicación que se envía a Fichaprop: la dirección de Zonaprop o, si no la informa,
        // la más cercana a las coordenadas de la publicación según OpenStreetMap.
        let direccionFichaprop = propiedadData.direccion;
        const coordsDeZonaprop = ubicacion.coords && esCoordenadaCABA(data.latitud, data.longitud) && ubicacion.coords.lat === data.latitud;
        if (!direccionFichaprop && coordsDeZonaprop) {
            direccionFichaprop = await direccionDesdeCoords(ubicacion.coords.lat, ubicacion.coords.lng);
            if (direccionFichaprop) console.log(`[${indice}/${total}] ${id_propiedad}: sin dirección en Zonaprop; para Fichaprop se usa la más cercana según OpenStreetMap: ${direccionFichaprop}`);
        }

        let fp = null;
        if (direccionFichaprop) {
            fp = await consultarFichaprop(context, direccionFichaprop);
        } else {
            console.warn(`[${indice}/${total}] ${id_propiedad}: sin dirección, no se puede consultar Fichaprop.`);
        }
        if (fp?.barrio && !ubicacion.barrio && !data.barrio_confirmado) {
            propiedadData.barrio_zona = fp.barrio.slice(0, 50); // barrio oficial (USIG) según Fichaprop
        }

        if (CONFIG.DRY_RUN) {
            console.log('[SCRAPER_DRY_RUN] No se escribió nada en Neon. Extracción:', JSON.stringify({ id_propiedad, link, precio_real_usd, propiedad: propiedadData, coordenadas: ubicacion.coords, fichaprop: fp, barrio_confirmado_por_zonaprop: data.barrio_confirmado, state: data.diagnosticoState, candidatos: data.diagnosticoCaracteristicas }, null, 2));
            await delay(...CONFIG.DELAY_ENTRE_PROPIEDADES);
            return true;
        }

        const resultadoIA = await estimarPrecioIA(propiedadData);

        let coordsFinales = ubicacion.coords;
        if (!coordsFinales && resultadoIA.coordenadas && esCoordenadaCABA(resultadoIA.coordenadas.lat, resultadoIA.coordenadas.lng) && !esCentroPorDefecto(resultadoIA.coordenadas)) {
            coordsFinales = resultadoIA.coordenadas;
        }

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
        // Conecta con el Chrome que abriste manualmente en el puerto 9222.
        // Usa su contexto existente (con sus cookies de Cloudflare); no crea otro navegador.
        browser = await chromium.connectOverCDP(CONFIG.CDP_URL);
        const contexts = browser.contexts();
        if (!contexts.length) {
            throw new Error('Chrome respondió por CDP pero no tiene un contexto disponible.');
        }
        context = contexts[0];
        context.setDefaultTimeout(15000);
        console.log(`[Chrome] Conectado al Chrome existente por CDP: ${CONFIG.CDP_URL}`);
    } catch (err) {
        console.error(`[Chrome] No se pudo conectar al navegador: ${err.message}`);
        console.error(`Verificá que Chrome esté abierto con --remote-debugging-port=9222 (${CONFIG.CDP_URL}).`);
        console.error('Ejemplo: & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\\chrome-debug"');
        await pool.end().catch(() => {});
        process.exit(1);
    }

    const page = await context.newPage();

    try {
        let links;
        if (CONFIG.URL_PRUEBA.trim()) {
            const urlPrueba = new URL(CONFIG.URL_PRUEBA.trim());
            if (!/(^|\.)zonaprop\.com\.ar$/i.test(urlPrueba.hostname) || !/\/propiedades\/.*-\d+\.html$/i.test(urlPrueba.pathname)) {
                throw new Error('SCRAPER_URL_PRUEBA debe ser una URL de una publicación de Zonaprop.');
            }
            urlPrueba.hash = '';
            links = [urlPrueba.href];
            console.log('[Diagnóstico] Se procesará únicamente la publicación indicada en SCRAPER_URL_PRUEBA.');
        } else {
            links = await obtenerLinksDeListado(page);
        }

        console.log(`${links.length} publicaciones únicas encontradas.`);

        if (links.length === 0) return;

        const { rows } = await pool.query('SELECT id_propiedad FROM propiedades');
        const idsProcesados = new Set(rows.map(r => r.id_propiedad));

        let nuevos = 0;
        let procesadas = 0;

        for (let i = 0; i < links.length; i++) {
            if (CONFIG.MAX_PROPIEDADES > 0 && procesadas >= CONFIG.MAX_PROPIEDADES) break;

            const link = links[i];
            const idMatch = link.match(/\-(\d+)\.html/);
            const id_propiedad = idMatch ? `zp-${idMatch[1]}` : null;
            if (!id_propiedad) continue;

            if (idsProcesados.has(id_propiedad) && !CONFIG.DRY_RUN) {
                console.log(`[${i + 1}/${links.length}] ${id_propiedad}: ya existe. Omitida.`);
                continue;
            }

            procesadas++;
            const guardada = await procesarPropiedad(context, link, id_propiedad, i + 1, links.length);
            if (guardada) nuevos++;
        }

        console.log(CONFIG.DRY_RUN
            ? `Diagnóstico finalizado. Publicaciones inspeccionadas: ${procesadas}. No se guardaron datos.`
            : `Finalizado. Nuevas propiedades guardadas: ${nuevos}`);

        if (!CONFIG.DRY_RUN && nuevos > 0) {
            try {
                await fetch(`${CONFIG.IA_URL}/reentrenar`, { method: 'POST', headers: headersIA() });
            } catch {
                // opcional
            }
        }

    } catch (e) {
        console.error(`Error general: ${e.message}`);
    } finally {
        await page.close().catch(() => {});
        // Con CDP, browser.close() solo desconecta Playwright del Chrome externo; no lo cierra.
        if (browser) await browser.close().catch(() => {});
        await pool.end().catch(() => {});
    }
})();