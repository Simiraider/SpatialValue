import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { Pool } from '@neondatabase/serverless';

dotenv.config({ path: '.env.local' });
dotenv.config();

const CONFIG = {
    PAGINAS_MAXIMAS: 5,
    URL_BASE: 'https://www.zonaprop.com.ar/casas-venta-capital-federal.html',
    URL_PAGINA: (n) => `https://www.zonaprop.com.ar/casas-venta-capital-federal-pagina-${n}.html`,
    CDP_ENDPOINT: 'http://localhost:9222',
    IA_URL: process.env.IA_URL || 'http://127.0.0.1:8000',
    IA_API_KEY: process.env.INTERNAL_API_KEY || '',
    DB_URL: process.env.SpatialValueStorage_DATABASE_URL || process.env.DATABASE_URL || process.env.NEON_DATABASE_URL,
    NOMINATIM_URL: 'https://nominatim.openstreetmap.org/search',
    NOMINATIM_USER_AGENT: 'SpatialValue-Scraper/1.0 (tu-email@ejemplo.com)',
    NOMINATIM_DELAY_MS: 1000,
    COORDENADAS_DEFAULT: { lat: -34.6037, lng: -58.3816 },
    DELAY_ENTRE_PROPIEDADES: [1000, 2000],
    PESTANIAS_A_EXPANDIR: ['Características generales', 'Ambientes', 'Servicios', 'Instalaciones'],
};

if (!CONFIG.DB_URL) {
    console.error('No se encontró la variable de base de datos en .env ni .env.local');
    process.exit(1);
}

const pool = new Pool({ connectionString: CONFIG.DB_URL });

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

const normalizarDireccionFichaprop = (direccion) => {
    if (!direccion) return null;
    return direccion
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\bav\.?\b/g, 'avenida')
        .replace(/\bpje\.?\b/g, 'pasaje')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
};

const delay = (min, max) => new Promise(r => setTimeout(r, min + Math.random() * (max - min)));

const geocodeCache = new Map();

const geocodeDireccion = async (direccion) => {
    if (!direccion) return null;
    if (geocodeCache.has(direccion)) return geocodeCache.get(direccion);

    try {
        const url = `${CONFIG.NOMINATIM_URL}?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(direccion)}`;
        const res = await fetch(url, { headers: { 'User-Agent': CONFIG.NOMINATIM_USER_AGENT } });
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

const resolverCoordenadas = async (direccionTexto, barrioZona) => {
    if (direccionTexto) {
        const coords = await geocodeDireccion(`${direccionTexto}, Capital Federal, Argentina`);
        if (coords) return coords;
    }
    if (barrioZona) {
        const coords = await geocodeDireccion(`${barrioZona}, Capital Federal, Argentina`);
        if (coords) return coords;
    }
    return CONFIG.COORDENADAS_DEFAULT;
};

// El IPS de la red (ej. FortiGuard) puede bloquear la request por patrón de tráfico
// automatizado de forma intermitente, no por tener el dominio en una lista negra fija.
// Por eso NO se desactiva Fichaprop para toda la corrida: solo se reintenta una vez
// con una pausa, y si sigue bloqueado se omite esa propiedad puntual.
const esPaginaDeBloqueoRed = (titulo, textoCompleto) => {
    const marcas = ['fortiguard', 'access blocked', 'web page blocked', 'web filter', 'blocked by'];
    const combinado = `${titulo} ${textoCompleto}`.toLowerCase();
    return marcas.some(m => combinado.includes(m));
};

const irAFichaprop = async (pageFP, slug) => {
    const response = await pageFP.goto(`https://fichaprop.ar/edificio/${slug}`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
    });
    if (!response || response.status() === 404) return 'no-encontrado';

    const titulo = await pageFP.title();
    const textoInicial = await pageFP.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (esPaginaDeBloqueoRed(titulo, textoInicial)) return 'bloqueado';

    return 'ok';
};

const consultarFichaprop = async (context, direccion) => {
    const slug = normalizarDireccionFichaprop(direccion);
    if (!slug) return null;

    const pageFP = await context.newPage();
    try {
        let resultado = await irAFichaprop(pageFP, slug);

        if (resultado === 'bloqueado') {
            await pageFP.waitForTimeout(2000 + Math.random() * 2000);
            resultado = await irAFichaprop(pageFP, slug);
        }

        if (resultado === 'no-encontrado') return null;
        if (resultado === 'bloqueado') {
            console.warn('Fichaprop: bloqueado por el IPS de la red en este intento. Se omite esta propiedad.');
            return null;
        }

        await pageFP.waitForTimeout(800);

        return await pageFP.evaluate(() => {
            const textoCompleto = document.body ? document.body.innerText : '';
            if (textoCompleto.includes('No encontramos este edificio')) return null;

            const spans = Array.from(document.querySelectorAll('span'));
            const comunaSpan = spans.find(s => (s.textContent || '').includes('Comuna'));
            const comunaText = comunaSpan ? comunaSpan.textContent.trim() : null;

            const obtenerTextoBloque = (palabraClave) => {
                const elementos = Array.from(document.querySelectorAll('div, section, article, p, span'));
                for (const el of elementos) {
                    const txt = (el.innerText || el.textContent || '').trim();
                    if (txt.includes(palabraClave) && txt.length < 150) return txt.replace(/\n/g, ' - ');
                }
                return null;
            };

            const matchResenas = textoCompleto.match(/(\d+)\s*reseñas/i);

            return {
                ruido: obtenerTextoBloque('dBA'),
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
    let linksTotales = [];

    for (let pagina = 1; pagina <= CONFIG.PAGINAS_MAXIMAS; pagina++) {
        const urlPagina = pagina === 1 ? CONFIG.URL_BASE : CONFIG.URL_PAGINA(pagina);

        try {
            console.log(`Página ${pagina}: buscando links...`);
            await page.goto(urlPagina, { waitUntil: 'domcontentloaded', timeout: 30000 });

            const selectorListado = await waitForAny(page, [
                '[data-qa="posting-card"]', '[data-posting-id]', 'div[class*="posting-card"]',
                'ol[class*="postings"] li', 'article',
            ], 15000);

            if (!selectorListado) {
                console.warn(`Página ${pagina}: sin publicaciones detectadas.`);
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
            console.warn(`Página ${pagina}: error al cargar (${err.message}).`);
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

/**
 * Parsea window.__INITIAL_STATE__ con un contador de llaves que respeta strings,
 * en vez de un regex no-greedy (que corta el JSON en el primer "};" interno y
 * hace fallar el JSON.parse silenciosamente).
 */
const extraerDatosDePagina = (textoAdicionalTabs) => {
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
                        direccionState = posting.postingLocation?.address || posting.postingLocation?.name || null;
                        barrioState = posting.postingLocation?.location?.name || null;
                        const priceObj = posting.priceOperationTypes?.[0]?.prices?.[0];
                        if (priceObj) precioState = `${priceObj.currency || ''} ${priceObj.amount || ''}`;
                    }
                }
            }
        }
    } catch {
        // si el estado inline cambió de formato, seguimos con los fallbacks del DOM
    }

    const textoCompleto = (document.body ? document.body.innerText : '') + ' ' + (textoAdicionalTabs || '');
    const textoLower = textoCompleto.toLowerCase();

    const esEnConstruccion = /en construcci[oó]n|en pozo|emprendimiento|al pozo/.test(textoLower);

    let direccion = direccionState;
    const elDireccionDOM = document.querySelector('[data-qa="location"], [class*="Location"], h2[class*="title"]');
    if (!direccion && elDireccionDOM) {
        direccion = (elDireccionDOM.innerText || elDireccionDOM.textContent || '').trim();
    }
    const barrio_zona = barrioState || 'Capital Federal';

    let superficie_total = null;
    let superficie_cubierta = null;
    let ambientes = null;
    let banos = null;
    let dormitorios = null;
    let anios_de_antiguedad = null;
    let disposicion = 'No especificada';
    let orientacion = 'No especificada';

    const featureNodes = Array.from(document.querySelectorAll(
        '[class*="icon-feature"], [class*="section-icon-features"] li, [data-qa="main-features"] > div, [class*="MainFeatures"] > div'
    ));

    featureNodes.forEach(node => {
        const txt = (node.innerText || node.textContent || '').trim();
        const txtLower = txt.toLowerCase();

        if (txtLower.includes('m² cub') || txtLower.includes('m2 cub')) {
            const matchRango = txt.match(/(\d+)\s*(?:a|-|hasta)\s*(\d+)/i);
            const matchUnico = txt.match(/(\d+)/);
            if (matchRango) superficie_cubierta = Math.round((parseInt(matchRango[1], 10) + parseInt(matchRango[2], 10)) / 2);
            else if (matchUnico) superficie_cubierta = parseInt(matchUnico[1], 10);
        } else if (txtLower.includes('m²') || txtLower.includes('m2')) {
            const matchRango = txt.match(/(\d+)\s*(?:a|-|hasta)\s*(\d+)/i);
            const matchUnico = txt.match(/(\d+)/);
            if (matchRango) superficie_total = Math.round((parseInt(matchRango[1], 10) + parseInt(matchRango[2], 10)) / 2);
            else if (matchUnico) superficie_total = parseInt(matchUnico[1], 10);
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

    // Precio: __INITIAL_STATE__ -> data-qa="price" -> cualquier nodo con clase Price/price -> texto completo.
    // El fallback por clase es clave: el chequeo de "página cargada" usa ese selector amplio,
    // así que la extracción tiene que aceptarlo también o queda vacía aunque el precio sí esté visible.
    // Un candidato nunca es el precio si el texto menciona expensas, aunque matchee
    // el selector o el regex de moneda (ej. "Expensas $ 1.200" en el mismo nodo).
    const pareceExpensas = (txt) => /expensa/i.test(txt);
    // El precio tachado "antes del descuento" vive en un bloque separado
    // (ej. id="react-discount-2", clase "...discount-container...") que puede
    // aparecer antes del precio real en el DOM y colarse si no se excluye.
    const esNodoDeDescuento = (el) =>
        !!el.closest('[class*="discount" i],[id*="discount" i]');

    let precioUSD = precioState;

    if (!precioUSD) {
        // Selector específico visto en el DOM real (price-item-container > price-value),
        // antes de caer a selectores genéricos que son más propensos a falsos positivos.
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
            // El texto tiene que parecer un precio (moneda + números), no cualquier
            // elemento cuya clase matchee "price" (ej. un botón "Ocultar aviso" o expensas).
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

    return {
        tipo_propiedad: data.tipo_propiedad,
        barrio_zona: data.barrio_zona,
        direccion: data.direccion || null,
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
        if (res.status === 401) console.warn('API de IA: 401 Unauthorized (revisá INTERNAL_API_KEY en .env.local).');
    } catch {
        // si la API de IA no responde, seguimos sin estimación
    }
    return {};
};

const resolverCoordsFinales = async (data, resultadoIA, propiedadData) => {
    if (data.latitud && data.longitud) return { lat: data.latitud, lng: data.longitud };
    if (resultadoIA.coordenadas) return resultadoIA.coordenadas;
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
        id_propiedad, link, p.tipo_propiedad, p.barrio_zona, p.direccion, p.ambientes, p.dormitorios, p.banos,
        p.superficie_total_m2, p.superficie_cubierta_m2, p.estado, p.anios_de_antiguedad, p.piso,
        p.orientacion, p.disposicion, p.cochera, p.balcon, p.terraza, p.patio, p.pileta, p.parrilla,
        p.seguridad_24hs, p.ascensor, p.expensas_ars, p.baulera, p.sum, p.seguridad_tipo, p.camara,
        p.gym, p.lounge, p.laundry, precio_real_usd, precio_estimado_ia_usd || null,
        coordsFinales ? JSON.stringify(coordsFinales) : null, fechaPublicacion,
        fp?.ruido || null, fp?.obras || null, fp?.subte || null, fp?.plazas || null,
        fp?.escuelas || null, fp?.comuna || null, fp?.resenas || 0,
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
            console.warn(`[${indice}/${total}] ${id_propiedad}: bloqueo detectado. Omitida.`);
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

        // El gate anterior ("cargadoOk") solo garantiza que ALGÚN nodo con clase
        // Price/price tiene texto, no que sea el que después leemos: a veces el precio
        // real todavía no hidrató. Si salió vacío, se reintenta una vez tras una pausa corta.
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
    try {
        browser = await chromium.connectOverCDP(CONFIG.CDP_ENDPOINT);
    } catch {
        console.error(`Error al conectar con Chrome en ${CONFIG.CDP_ENDPOINT}`);
        process.exit(1);
    }

    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();

    try {
        const links = await obtenerLinksDeListado(page);
        console.log(`${links.length} publicaciones únicas encontradas.`);

        if (links.length === 0) return;

        const { rows } = await pool.query('SELECT id_propiedad FROM propiedades');
        const idsProcesados = new Set(rows.map(r => r.id_propiedad));
        let nuevos = 0;

        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            const idMatch = link.match(/-(\d+)\.html/);
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
            }
        }

    } catch (e) {
        console.error(`Error general: ${e.message}`);
    } finally {
        if (browser) await browser.close();
        await pool.end();
    }
})();