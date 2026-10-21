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
 * Convierte los formatos de dirección que devuelve el estado interno de Zonaprop
 * (a veces string, a veces objeto) en texto legible.
 */
const textoDeValor = (valor) => {
    if (typeof valor === 'string' || typeof valor === 'number') return String(valor).trim();
    if (Array.isArray(valor)) return valor.map(textoDeValor).filter(Boolean).join(' ');
    if (!valor || typeof valor !== 'object') return '';

    const altura = valor.streetNumber || valor.number || valor.numeration || valor.altura;
    const calle = valor.streetName || valor.street || valor.road || valor.calle || (altura ? valor.address || valor.name : null);
    if (calle && altura) return `${textoDeValor(calle)} ${textoDeValor(altura)}`.trim();

    for (const key of ['formattedAddress', 'fullAddress', 'streetAddress', 'addressLine', 'address', 'name', 'label', 'value', 'text', 'displayName']) {
        const resultado = textoDeValor(valor[key]);
        if (resultado) return resultado;
    }
    return '';
};

/** Rechaza títulos, datos de interfaz y bloques de código guardados por error como dirección. */
const esTituloNoDireccion = (valor) => {
    const txt = textoDeValor(valor).replace(/\s+/g, ' ').trim();
    if (!txt) return true;
    if (txt.length > 100 || /<\/?[a-z][^>]*>|__INITIAL_STATE__|window\.|function\s*\(|\{\s*["']/.test(txt)) return true;
    if (txt.includes('·') || /m²|\bm2\b/i.test(txt)) return true;
    // Para no confundir un barrio con una dirección, exigir altura/código numérico.
    if (!/\d{1,}/.test(txt)) return true;
    if (/^(?:[a-záéíóúñ .-]+,?\s+)?(?:capital federal|caba|buenos aires|belgrano|palermo|recoleta|caballito|nuñez|núñez)$/i.test(txt)) return true;
    if (/^(casa|departamento|depto|ph|terreno|local|oficina|emprendimiento)\b/i.test(txt)) return true;
    if (/\b\d+\s*(amb(?:ientes)?|dorm(?:itorios)?|baños?)\b/i.test(txt)) return true;
    if (/^(capital federal|ciudad autónoma de buenos aires|caba|buenos aires|belgrano|palermo|recoleta|caballito|villa urquiza|nuñez|núñez)$/i.test(txt)) return true;
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
    // En Argentina "$" puede ser ARS. Aceptar solo monedas USD explícitas evita
    // guardar pesos como si fueran dólares.
    const match = String(texto).match(/(?:USD|U\$S|US\$|DOLARES?\s+ESTADOUNIDENSES?)\s*([\d.,]+)/i);
    if (!match) return 0;
    const numero = match[1].trim();
    const valor = Number(numero.replace(/\./g, '').replace(',', '.'));
    return (Number.isFinite(valor) && valor >= 100 && valor <= 20000000) ? Math.round(valor) : 0;
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
 * Fichaprop usa slugs de la forma /edificio/parana-552.
 * Zonaprop suele dar "Mendoza al 4500", "Av. Cabildo 2500" o direcciones
 * acompañadas por barrio/provincia; se limpia el texto antes de crear variantes.
 */
const limpiarDireccionParaFichaprop = (direccion) => {
    const texto = textoDeValor(direccion).replace(/\s+/g, ' ').trim();
    if (!texto || esTituloNoDireccion(texto)) return '';

    let dir = texto
        .split(/\bentre\b|\besquina\b|\besq\.?\b/i)[0]
        .split(',')[0]
        .replace(/\b(?:altura|n[°ºo.]?)\s*/gi, ' ')
        .replace(/\bal\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return esTituloNoDireccion(dir) ? '' : dir;
};

const slugDireccion = (direccion) => limpiarDireccionParaFichaprop(direccion)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(?:avenida|av\.?|avda\.?)\b/g, 'av')
    .replace(/\b(?:pasaje|pje\.?)\b/g, 'pje')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-');

const variantesSlugsFichaprop = (direccion) => {
    const limpio = limpiarDireccionParaFichaprop(direccion);
    if (!limpio) return [];

    const slugs = new Set();
    const base = slugDireccion(limpio);
    if (base.length > 2) slugs.add(base);

    // Probar tanto las abreviaturas habituales como el nombre expandido.
    const sinAcentos = limpio.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const variante of [
        sinAcentos.replace(/\b(?:av\.?|avda\.?|avenida)\s*/g, 'av '),
        sinAcentos.replace(/\b(?:av\.?|avda\.?|avenida)\s*/g, 'avenida '),
        sinAcentos.replace(/\bavenida\s+/g, 'av '),
        sinAcentos.replace(/\bavenida\s+/g, ''),
        sinAcentos.replace(/\bpje\.?\s*/g, 'pasaje '),
        sinAcentos.replace(/\bpasaje\s+/g, 'pje '),
    ]) {
        const slug = variante
            .replace(/\bal\b/g, ' ')
            .replace(/\b(?:altura|n[°ºo.]?)\s*/g, ' ')
            .replace(/[^a-z0-9\s-]/g, ' ')
            .trim()
            .replace(/\s+/g, '-');
        if (slug.length > 2) slugs.add(slug);
    }
    return [...slugs];
};

const delay = (min, max) => new Promise(r => setTimeout(r, min + Math.random() * (max - min)));

const esCoordenadaCABA = (lat, lng) => {
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || Number(lat) === 0 || Number(lng) === 0) return false;
    return (Number(lat) >= -34.7100 && Number(lat) <= -34.5000) && (Number(lng) >= -58.5500 && Number(lng) <= -58.3200);
};

const esCoordenadaConcreta = (lat, lng) => {
    if (!esCoordenadaCABA(lat, lng)) return false;
    // El centro usado históricamente como fallback no es la ubicación de un aviso.
    return !(Math.abs(Number(lat) - CONFIG.COORDENADAS_DEFAULT.lat) < 0.0002 &&
             Math.abs(Number(lng) - CONFIG.COORDENADAS_DEFAULT.lng) < 0.0002);
};

const limpiarDireccionGeocode = (direccion) => {
    const texto = textoDeValor(direccion);
    if (!texto || esTituloNoDireccion(texto)) return '';
    return texto
        .replace(/\b(?:ubicación|direccion|dirección)\s*:?/gi, '')
        .replace(/\bavda?\.?\s*/gi, 'Avenida ')
        .split(/\bentre\b|\n|\,/i)[0]
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

        if (esCoordenadaConcreta(lat, lng)) {
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
        const barrioLimpio = textoDeValor(barrioZona).split(',')[0].trim();
        // No usar el centro de CABA como si fuera la ubicación de la propiedad.
        if (barrioLimpio && !/^(capital federal|caba|buenos aires|ciudad autónoma de buenos aires)$/i.test(barrioLimpio)) {
            const coordsBarrio = await geocodeDireccion(`${barrioLimpio}, Capital Federal, Buenos Aires, Argentina`);
            if (coordsBarrio) return coordsBarrio;
        }
    }

    return null;
};

const consultarFichaprop = async (context, direccion) => {
    const slugs = variantesSlugsFichaprop(direccion);
    if (!slugs.length) {
        console.warn(`[Fichaprop] Dirección no utilizable: ${textoDeValor(direccion) || '(vacía)'}`);
        return null;
    }

    const pageFP = await context.newPage();
    pageFP.setDefaultTimeout(5000);

    const extraerFichaActual = async () => {
        return pageFP.evaluate(() => {
            const textoCompleto = document.body?.innerText || '';
            const lineas = textoCompleto
                .split(/\n+/)
                .map(linea => linea.replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            const lower = textoCompleto.toLowerCase();
            const urlFicha = window.location.pathname.startsWith('/edificio/');
            const tieneContenidoFicha = lineas.some(l => /^sobre esta ficha$/i.test(l)) ||
                lineas.some(l => /^datos de registro:/i.test(l));

            if (!urlFicha || !tieneContenidoFicha || lower.includes('no encontramos este edificio')) {
                return null;
            }

            // La ficha muestra resúmenes breves al comienzo. Se selecciona la línea
            // informativa concreta, no cualquier div padre que contenga la palabra.
            const buscarLinea = (predicado) => lineas.find(l => l.length <= 180 && predicado(l)) || null;
            const ruido = buscarLinea(l => /\bdba\b/i.test(l) && /noche/i.test(l));
            const obras = buscarLinea(l => /\bobras?\b/i.test(l) && /(?:300\s*m|cuadra|media cuadra|a la m[aá]s cercana)/i.test(l));
            const subte = buscarLinea(l => /\bsubte\b/i.test(l) && /500\s*m/i.test(l));
            const plazas = buscarLinea(l => /\bplazas?(?:\s+y\s+parques)?\b/i.test(l) && /500\s*m/i.test(l));
            const escuelas = buscarLinea(l => /\bescuelas?\b|\bjardines\b/i.test(l) && /500\s*m/i.test(l));
            const comuna = buscarLinea(l => /\bcomuna\s+\d+\b/i.test(l) && l.length < 100);
            const matchResenas = textoCompleto.match(/(\d+)\s*reseñas?\s+publicadas?/i);

            return {
                url: window.location.href,
                titulo: document.querySelector('h1')?.innerText?.trim() || null,
                ruido,
                obras,
                subte,
                plazas,
                escuelas,
                comuna,
                resenas: matchResenas ? parseInt(matchResenas[1], 10) : null,
                camposDetectados: [ruido, obras, subte, plazas, escuelas, comuna].filter(Boolean).length,
            };
        });
    };

    const irAFichaDirecta = async () => {
        for (const slug of slugs) {
            try {
                const response = await pageFP.goto(`https://fichaprop.ar/edificio/${encodeURIComponent(slug)}`, {
                    waitUntil: 'domcontentloaded',
                    timeout: 12000,
                }).catch(() => null);
                if (!response || response.status() >= 400) continue;
                await pageFP.waitForTimeout(350);
                const ficha = await extraerFichaActual();
                if (ficha) return ficha;
            } catch {
                // Probar el siguiente slug; la búsqueda del sitio será el último recurso.
            }
        }
        return null;
    };

    const buscarDesdeInicio = async () => {
        try {
            await pageFP.goto('https://fichaprop.ar/', { waitUntil: 'domcontentloaded', timeout: 15000 });
            await pageFP.waitForTimeout(300);

            const inputs = pageFP.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
            const inputCount = await inputs.count();
            let inputSeleccionado = null;
            for (let i = 0; i < inputCount; i++) {
                const input = inputs.nth(i);
                if (!(await input.isVisible().catch(() => false))) continue;
                const meta = await input.evaluate(el => [el.placeholder, el.getAttribute('aria-label'), el.name, el.id].join(' ').toLowerCase()).catch(() => '');
                if (/direcci[oó]n|calle|buscar|domicilio|arevalo|ar[eé]valo/.test(meta)) {
                    inputSeleccionado = input;
                    break;
                }
            }
            // En la portada el campo principal puede no tener atributos descriptivos.
            if (!inputSeleccionado) {
                for (let i = 0; i < inputCount; i++) {
                    const input = inputs.nth(i);
                    if (await input.isVisible().catch(() => false)) { inputSeleccionado = input; break; }
                }
            }
            if (!inputSeleccionado) return null;

            const consulta = limpiarDireccionParaFichaprop(direccion);
            await inputSeleccionado.fill(consulta);
            await pageFP.waitForTimeout(900);

            // Si el autocompletado ofrece una ficha/dirección, seguir esa URL canónica.
            const sugerencia = await pageFP.evaluate((consultaDireccion) => {
                const normalizar = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
                const consulta = normalizar(consultaDireccion);
                const numero = consulta.match(/\b\d{1,5}\b/)?.[0] || '';
                const palabras = consulta.split(' ').filter(p => p && p !== numero && p.length > 2 && !['avenida','calle','pasaje','pje','avda','altura'].includes(p));
                const links = Array.from(document.querySelectorAll('a[href*="/edificio/"]'));
                const candidatos = links.map(a => ({
                    href: a.href,
                    texto: normalizar(a.innerText || a.textContent || ''),
                })).filter(a => a.texto && a.texto.length < 150);
                return candidatos.find(a => numero && a.texto.includes(numero) && palabras.some(p => a.texto.includes(p)))?.href || null;
            }, consulta);

            if (sugerencia) {
                await pageFP.goto(sugerencia, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null);
                await pageFP.waitForTimeout(250);
                const fichaSugerida = await extraerFichaActual();
                if (fichaSugerida) return fichaSugerida;
            }

            // Si no hay enlace de autocompletado, enviar el formulario visible.
            const botonBuscar = pageFP.getByRole('button', { name: /buscar/i }).first();
            if (await botonBuscar.isVisible().catch(() => false)) {
                await Promise.all([
                    pageFP.waitForLoadState('domcontentloaded', { timeout: 6000 }).catch(() => null),
                    botonBuscar.click().catch(() => null),
                ]);
            } else {
                await inputSeleccionado.press('Enter').catch(() => {});
            }
            await pageFP.waitForTimeout(1200);

            let ficha = await extraerFichaActual();
            if (ficha) return ficha;

            // Algunas interfaces sólo muestran una sugerencia tras enviar el formulario.
            const hrefResultado = await pageFP.evaluate((consultaDireccion) => {
                const normalizar = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
                const consulta = normalizar(consultaDireccion);
                const numero = consulta.match(/\b\d{1,5}\b/)?.[0] || '';
                const palabras = consulta.split(' ').filter(p => p && p !== numero && p.length > 2 && !['avenida','calle','pasaje','pje','avda','altura'].includes(p));
                return Array.from(document.querySelectorAll('a[href*="/edificio/"]'))
                    .map(a => ({ href: a.href, texto: normalizar(a.innerText || a.textContent || '') }))
                    .find(a => numero && a.texto.includes(numero) && palabras.some(p => a.texto.includes(p)))?.href || null;
            }, consulta);
            if (hrefResultado) {
                await pageFP.goto(hrefResultado, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null);
                await pageFP.waitForTimeout(250);
                ficha = await extraerFichaActual();
                if (ficha) return ficha;
            }
        } catch (err) {
            console.warn(`[Fichaprop] Búsqueda por portada falló para "${direccion}": ${err.message}`);
        }
        return null;
    };

    try {
        let ficha = await irAFichaDirecta();
        if (!ficha) ficha = await buscarDesdeInicio();

        if (!ficha) {
            console.warn(`[Fichaprop] No se encontró una ficha para "${textoDeValor(direccion)}". Slugs probados: ${slugs.join(', ')}`);
            return null;
        }

        if (!ficha.ruido && !ficha.obras && !ficha.subte && !ficha.plazas && !ficha.escuelas && !ficha.comuna) {
            console.warn(`[Fichaprop] Se abrió ${ficha.url}, pero no se pudieron leer los indicadores. Revisar el HTML actual del sitio.`);
            return null;
        }

        console.log(`[Fichaprop] OK: "${textoDeValor(direccion)}" -> ${ficha.url}; campos: ${ficha.camposDetectados}/6.`);
        return ficha;
    } catch (err) {
        console.warn(`[Fichaprop] Error consultando "${textoDeValor(direccion)}": ${err.message}`);
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

            const linksPagina = await page.evaluate(() => {
                let cards = Array.from(document.querySelectorAll(
                    '[data-qa="posting-card"], [data-posting-id], div[class*="posting-card"], ol[class*="postings"] li'
                ));
                if (!cards.length) cards = Array.from(document.querySelectorAll('article'));

                const anchors = cards.flatMap(card => {
                    const propios = card.matches('a[href]') ? [card] : [];
                    return propios.concat(Array.from(card.querySelectorAll('a[href]')));
                });

                return [...new Set(anchors.map(a => {
                    try {
                        const u = new URL(a.href);
                        if (!/(^|\.)zonaprop\.com\.ar$/i.test(u.hostname)) return null;
                        if (!/^\/propiedades\/.*\.html$/i.test(u.pathname)) return null;
                        // Quitar parámetros de tracking para evitar duplicados del mismo aviso.
                        return `${u.origin}${u.pathname}`;
                    } catch { return null; }
                }).filter(Boolean))];
            });

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
    for (const pestania of CONFIG.PESTANIAS_A_EXPANDIR) {
        const selector = detailPage.locator(`button:has-text("${pestania}"), [role="tab"]:has-text("${pestania}")`).first();
        if (await selector.isVisible().catch(() => false)) {
            await selector.click({ force: true }).catch(() => {});
            await detailPage.waitForTimeout(120);
        }
    }
    // La función extrae los bloques del DOM luego de expandir; no acumular el body
    // completo varias veces, porque mezcla características de anuncios recomendados.
    return '';
};

const extraerDatosDePagina = (textoAdicionalTabs) => {
    const textoValorLocal = (valor) => {
        if (typeof valor === 'string' || typeof valor === 'number') return String(valor).trim();
        if (Array.isArray(valor)) return valor.map(textoValorLocal).filter(Boolean).join(' ');
        if (!valor || typeof valor !== 'object') return '';
        const altura = valor.streetNumber || valor.number || valor.numeration || valor.altura;
        const calle = valor.streetName || valor.street || valor.road || valor.calle || (altura ? valor.address || valor.name : null);
        if (calle && altura) return `${textoValorLocal(calle)} ${textoValorLocal(altura)}`.trim();
        for (const key of ['formattedAddress', 'fullAddress', 'streetAddress', 'addressLine', 'address', 'name', 'label', 'value', 'text', 'displayName']) {
            const resultado = textoValorLocal(valor[key]);
            if (resultado) return resultado;
        }
        return '';
    };

    const esDireccionDescartable = (valor) => {
        const s = textoValorLocal(valor).replace(/\s+/g, ' ').trim();
        if (!s) return true;
        if (s.length > 100 || /<\/?[a-z][^>]*>|__INITIAL_STATE__|window\.|function\s*\(|\{\s*["']/.test(s)) return true;
        if (s.includes('·') || /m²|\bm2\b/i.test(s)) return true;
        if (!/\d{1,}/.test(s)) return true;
        if (/^(?:[a-záéíóúñ .-]+,?\s+)?(?:capital federal|caba|buenos aires|belgrano|palermo|recoleta|caballito|nuñez|núñez)$/i.test(s)) return true;
        if (/^(casa|departamento|depto|ph|terreno|local|oficina|emprendimiento)\b/i.test(s)) return true;
        if (/\b\d+\s*(amb(?:ientes)?|dorm(?:itorios)?|baños?)\b/i.test(s)) return true;
        if (/^(capital federal|ciudad autónoma de buenos aires|caba|buenos aires|belgrano|palermo|recoleta|caballito|villa urquiza|nuñez|núñez)$/i.test(s)) return true;
        return false;
    };

    const numeroSeguro = (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n !== 0 ? n : null;
    };

    const primerTexto = (...valores) => {
        for (const valor of valores) {
            const txt = textoValorLocal(valor);
            if (txt) return txt;
        }
        return null;
    };

    const buscarPosting = (root) => {
        const visitados = new Set();
        const recorrer = (obj, profundidad = 0) => {
            if (!obj || typeof obj !== 'object' || profundidad > 10 || visitados.has(obj)) return null;
            visitados.add(obj);
            if (obj.postingLocation && (obj.priceOperationTypes || obj.mainFeatures || obj.postingId || obj.id)) return obj;
            if (obj.posting && typeof obj.posting === 'object') {
                const directo = recorrer(obj.posting, profundidad + 1);
                if (directo) return directo;
            }
            if (Array.isArray(obj)) {
                for (const item of obj.slice(0, 100)) {
                    const encontrado = recorrer(item, profundidad + 1);
                    if (encontrado) return encontrado;
                }
            } else {
                for (const [key, value] of Object.entries(obj)) {
                    if (['analytics', 'tracking', 'translations', 'experiments'].includes(key)) continue;
                    if (value && typeof value === 'object') {
                        const encontrado = recorrer(value, profundidad + 1);
                        if (encontrado) return encontrado;
                    }
                }
            }
            return null;
        };
        return recorrer(root);
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
    let tipoState = null;
    let caracteristicasState = [];

    // 1) Preferir los datos estructurados del anuncio, no el texto general de la página.
    try {
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
            const contenido = script.textContent || '';
            if (!contenido.includes('__INITIAL_STATE__') && script.type !== 'application/ld+json') continue;

            let parsed = null;
            if (script.type === 'application/ld+json') {
                try { parsed = JSON.parse(contenido); } catch { continue; }
            } else {
                const idxMarca = contenido.indexOf('__INITIAL_STATE__');
                const idxLlave = contenido.indexOf('{', idxMarca);
                if (idxLlave < 0) continue;
                let profundidad = 0, enString = false, escape = false, jsonTexto = null;
                for (let i = idxLlave; i < contenido.length; i++) {
                    const c = contenido[i];
                    if (escape) { escape = false; continue; }
                    if (c === '\\') { escape = true; continue; }
                    if (c === '"') { enString = !enString; continue; }
                    if (enString) continue;
                    if (c === '{') profundidad++;
                    if (c === '}') {
                        profundidad--;
                        if (profundidad === 0) { jsonTexto = contenido.slice(idxLlave, i + 1); break; }
                    }
                }
                if (!jsonTexto) continue;
                try { parsed = JSON.parse(jsonTexto); } catch { continue; }
            }

            const posting = buscarPosting(parsed);
            if (posting) {
                const ubicacion = posting.postingLocation || {};
                const geo = ubicacion.geolocation || posting.geolocation || {};
                latitudState = numeroSeguro(geo.latitude ?? geo.lat ?? posting.latitude ?? posting.lat);
                longitudState = numeroSeguro(geo.longitude ?? geo.lng ?? geo.lon ?? posting.longitude ?? posting.lng);

                const candidatosDireccion = [
                    ubicacion.address,
                    ubicacion.realAddress,
                    ubicacion.formattedAddress,
                    ubicacion.streetAddress,
                    ubicacion.addressLine,
                    ubicacion.street,
                    posting.address,
                    posting.realAddress,
                    posting.formattedAddress,
                    posting.streetAddress,
                    posting.location?.address,
                    ubicacion.location?.address,
                ];
                direccionState = candidatosDireccion.map(textoValorLocal).find(txt => txt && !esDireccionDescartable(txt)) || null;

                barrioState = primerTexto(
                    ubicacion.zone?.name,
                    ubicacion.neighborhood?.name,
                    posting.neighborhood?.name,
                    ubicacion.location?.name,
                    ubicacion.name,
                    posting.location?.name
                );

                const operaciones = Array.isArray(posting.priceOperationTypes) ? posting.priceOperationTypes : [];
                const precios = operaciones.flatMap(op => Array.isArray(op.prices) ? op.prices : []);
                const precioUSD = precios.find(pr => /^(USD|U\$S|US\$|DOLAR|DÓLAR)$/i.test(String(pr.currency || '').trim()));
                // No convertir un precio en ARS a USD por error. Si el estado no trae
                // moneda USD explícita, el extractor intentará leer el precio visible.
                const precioElegido = precioUSD || null;
                if (precioElegido) precioState = `${precioElegido.currency || ''} ${precioElegido.amount || ''}`.trim();

                tipoState = primerTexto(
                    posting.propertyType?.name,
                    posting.propertyType?.value,
                    posting.realEstateType?.name,
                    posting.type?.name,
                    typeof posting.propertyType === 'string' ? posting.propertyType : null
                );

                const recorrerFeatures = (valor, etiquetaPadre = '') => {
                    if (!valor || typeof valor !== 'object') return;
                    if (Array.isArray(valor)) {
                        for (const item of valor) recorrerFeatures(item, etiquetaPadre);
                        return;
                    }
                    const etiqueta = primerTexto(valor.label, valor.name, valor.key, etiquetaPadre) || '';
                    const valorFeature = textoValorLocal(valor.value ?? valor.text ?? valor.description);
                    if (etiqueta && valorFeature) {
                        const linea = `${etiqueta}: ${valorFeature}`;
                        if (linea.length < 180) caracteristicasState.push(linea);
                        const l = etiqueta.toLowerCase();
                        const n = parseInt(valorFeature.match(/[\d]+/)?.[0] || '', 10);
                        if (Number.isFinite(n)) {
                            if (l.includes('total') && (l.includes('superficie') || l.includes('m2') || l.includes('m²'))) supTotalState = supTotalState || n;
                            if (l.includes('cubierta')) supCubiertaState = supCubiertaState || n;
                            if (l.includes('ambiente')) ambientesState = ambientesState || n;
                            if (l.includes('dormitorio')) dormitoriosState = dormitoriosState || n;
                            if (l.includes('baño') || l.includes('bano')) banosState = banosState || n;
                            if (l.includes('antig') || l.includes('año')) antiguedadState = antiguedadState ?? n;
                        }
                    }
                    for (const [key, child] of Object.entries(valor)) {
                        if (child && typeof child === 'object') recorrerFeatures(child, key);
                    }
                };
                recorrerFeatures(posting.mainFeatures || posting.sectionFeatures || posting.features || {});
                break;
            }

            // Fallback Schema.org: puede conservar address y geo aunque cambie el estado JS.
            const leerLd = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                if (Array.isArray(obj)) { obj.forEach(leerLd); return; }
                const addr = obj.address;
                const addrTexto = textoValorLocal(addr);
                if (!direccionState && addrTexto && !esDireccionDescartable(addrTexto)) direccionState = addrTexto;
                const geo = obj.geo || obj.geoCoordinates || {};
                if (latitudState == null) latitudState = numeroSeguro(geo.latitude);
                if (longitudState == null) longitudState = numeroSeguro(geo.longitude ?? geo.longitude);
                if (!tipoState && obj['@type']) tipoState = textoValorLocal(obj['@type']);
                for (const value of Object.values(obj)) if (value && typeof value === 'object') leerLd(value);
            };
            leerLd(parsed);
        }
    } catch (error) {
        // El DOM de abajo es el fallback; un campo inesperado no debe anular toda la extracción.
    }

    const textoBody = document.body ? document.body.innerText : '';
    const textoTitulo = (
        document.querySelector('[data-qa="POSTING_TITLE"]')?.innerText ||
        document.querySelector('h1')?.innerText ||
        document.title || ''
    ).replace(/\s+/g, ' ').trim();

    // 2) Fallback de dirección: solo elementos de ubicación, nunca el body ni scripts enteros.
    if (!direccionState) {
        const selectoresDireccion = [
            '[data-qa="section-location-property"] h2',
            '[data-qa*="location-property"]',
            '[class*="section-location"] h2',
            '[class*="LocationTitle"]',
            '[class*="location-title"]',
            '[data-qa="POSTING_LOCATION"]',
            '[data-qa*="address"]',
        ];
        const candidatos = [];
        for (const selector of selectoresDireccion) {
            for (const el of document.querySelectorAll(selector)) {
                const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                if (txt && txt.length <= 100) candidatos.push(txt);
            }
        }
        direccionState = candidatos.find(txt => !esDireccionDescartable(txt)) || null;
    }

    if (!barrioState) {
        const breadcrumb = document.querySelectorAll('[data-qa*="breadcrumb"] a, nav[aria-label*="breadcrumb" i] a');
        const nombres = Array.from(breadcrumb).map(el => (el.innerText || el.textContent || '').trim()).filter(Boolean);
        barrioState = nombres.length > 0 ? nombres[nombres.length - 1] : null;
    }

    const direccion = direccionState && !esDireccionDescartable(direccionState) ? textoValorLocal(direccionState) : null;
    const barrio_zona = barrioState || 'Capital Federal';

    let superficie_total = supTotalState;
    let superficie_cubierta = supCubiertaState;
    let ambientes = ambientesState;
    let banos = banosState;
    let dormitorios = dormitoriosState;
    let anios_de_antiguedad = antiguedadState;
    let disposicion = 'No especificada';
    let orientacion = 'No especificada';

    const featureSelectors = [
        '[class*="icon-feature"]',
        '[class*="section-icon-features"] li',
        '[data-qa="main-features"] > div',
        '[class*="MainFeatures"] > div',
        '[class*="feature-item"]',
        '[data-qa*="section-features"] li',
        '[data-qa*="characteristic"] li',
    ];
    const featureNodes = featureSelectors.flatMap(sel => Array.from(document.querySelectorAll(sel)));
    const fragmentosFeatures = [...caracteristicasState];
    const usados = new Set();

    featureNodes.forEach(node => {
        const txt = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt || txt.length > 180 || usados.has(txt)) return;
        usados.add(txt);
        fragmentosFeatures.push(txt);
        const lower = txt.toLowerCase();
        const m = txt.match(/\d+/);
        const n = m ? parseInt(m[0], 10) : null;
        if (n != null) {
            if (/m²\s*(?:tot|total)|m2\s*(?:tot|total)|superficie total|sup\. total/i.test(txt)) superficie_total = superficie_total || n;
            else if (/m²\s*cub|m2\s*cub|superficie cubierta|cubiertos/i.test(txt)) superficie_cubierta = superficie_cubierta || n;
            if (/ambiente/i.test(lower)) ambientes = ambientes || n;
            if (/dormitorio/i.test(lower)) dormitorios = dormitorios || n;
            if (/baño|bano/i.test(lower)) banos = banos || n;
            if (/antigüedad|antiguedad|años de antigüedad|año/i.test(lower)) anios_de_antiguedad = anios_de_antiguedad ?? n;
        }
        if (lower.trim() === 'frente') disposicion = 'Frente';
        if (lower.trim() === 'contrafrente') disposicion = 'Contrafrente';
        if (/^(n|s|e|o|ne|no|se|so)$/i.test(txt)) orientacion = txt.toUpperCase();
        if (/a estrenar|estrenar/i.test(lower)) anios_de_antiguedad = 0;
    });

    const textoCaracteristicas = fragmentosFeatures.join(' | ');
    const textoCaracteristicasLower = textoCaracteristicas.toLowerCase();
    const textoPropiedadLower = `${textoTitulo} ${direccion || ''} ${barrio_zona} ${textoCaracteristicas}`.toLowerCase();
    const esEnConstruccion = /en construcci[oó]n|en pozo|al pozo|emprendimiento/.test(`${textoTitulo} ${textoCaracteristicas}`.toLowerCase());

    // Fallbacks numéricos acotados a características de la publicación.
    if (!superficie_total) {
        const m = textoCaracteristicas.match(/(?:superficie\s+total|sup\.\s*total|m²?\s*tot(?:al)?(?:es)?)\D{0,20}(\d{2,5})/i);
        if (m) superficie_total = parseInt(m[1], 10);
    }
    if (!superficie_cubierta) {
        const m = textoCaracteristicas.match(/(?:superficie\s+cubierta|cubiertos|m²?\s*cub)\D{0,20}(\d{2,5})/i);
        if (m) superficie_cubierta = parseInt(m[1], 10);
    }

    // 3) Precio estructurado primero; DOM específico como respaldo. No aceptar cualquier número de la página.
    let precioUSD = precioState;
    const esNodoDeDescuento = (el) => !!el.closest('[class*="discount" i],[id*="discount" i]');
    if (!precioUSD) {
        const selectoresPrecio = [
            '[data-qa="price"]',
            '[class*="price-value" i]:not([class*="discount" i])',
            '[class*="PriceValue" i]',
        ];
        for (const selector of selectoresPrecio) {
            const el = document.querySelector(selector);
            if (!el || esNodoDeDescuento(el)) continue;
            const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            if (/(?:USD|U\$S|US\$)\s*[\d.,]+/i.test(txt)) { precioUSD = txt; break; }
        }
    }
    if (!precioUSD) {
        const matchTexto = textoTitulo.match(/(?:USD|U\$S|US\$)\s*[\d.,]+/i);
        if (matchTexto) precioUSD = matchTexto[0];
    }

    let expensas = 0;
    const candidatosExp = [...document.querySelectorAll('[class*="xpens" i],[data-qa="expenses"]')];
    for (const el of candidatosExp) {
        const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ');
        const m = txt.match(/(?:\$\s*)?([\d.]+(?:,\d+)?)/);
        if (m) {
            const valor = parseInt(m[1].replace(/\./g, '').replace(',', ''), 10);
            if (Number.isFinite(valor)) { expensas = valor; break; }
        }
    }

    const tipoTexto = `${tipoState || ''} ${textoTitulo}`.toLowerCase();
    let tipo_propiedad = 'Departamento';
    if (/casa|chalet|vivienda unifamiliar|singlefamilyresidence|\bhouse\b/.test(tipoTexto)) tipo_propiedad = 'Casa';
    else if (/ph\b/.test(tipoTexto)) tipo_propiedad = 'PH';
    else if (/terreno|lote/.test(tipoTexto)) tipo_propiedad = 'Terreno';
    else if (/local comercial/.test(tipoTexto)) tipo_propiedad = 'Local';
    else if (/oficina/.test(tipoTexto)) tipo_propiedad = 'Oficina';
    else if (/departamento|depto|monoambiente|piso/.test(tipoTexto)) tipo_propiedad = 'Departamento';

    const latitud = numeroSeguro(latitudState);
    const longitud = numeroSeguro(longitudState);

    return {
        textoLower: textoPropiedadLower,
        textoCaracteristicasLower,
        direccion,
        barrio_zona,
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
        disposicion,
        orientacion,
        latitud,
        longitud,
    };
};

const construirPropiedadData = (data) => {
    // Las amenities se buscan en los bloques de características del anuncio, no en
    // todo el body, porque Zonaprop también muestra inmuebles recomendados.
    const textoAmenidades = data.textoCaracteristicasLower || '';
    const check = (...words) => words.some(w => textoAmenidades.includes(w));

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
        ambientes: data.ambientes ?? null,
        dormitorios: data.dormitorios ?? null,
        banos: data.banos ?? null,
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
        latitud: data.latitud,
        longitud: data.longitud,
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

const resolverCoordsFinales = async (data, propiedadData) => {
    if (esCoordenadaConcreta(data.latitud, data.longitud)) {
        return { lat: Number(data.latitud), lng: Number(data.longitud) };
    }
    // No confiar en resultadoIA.coordenadas: la API devuelve coordenadas por defecto
    // cuando no recibe GPS y eso ubicaba propiedades distintas en el centro de CABA.
    return resolverCoordenadas(propiedadData.direccion, propiedadData.barrio_zona);
};

const guardarPropiedad = async (campos) => {
    const query = `
        INSERT INTO propiedades (
            id_propiedad, url, tipo_operacion, tipo_propiedad, barrio_zona, direccion, ambientes, dormitorios, banos,
            superficie_total_m2, superficie_cubierta_m2, estado, anios_de_antiguedad, piso,
            orientacion, disposicion, cochera, balcon, terraza, patio, pileta, parrilla,
            seguridad_24hs, ascensor, expensas_ars, baulera, sum, seguridad_tipo, camara,
            gym, lounge, laundry, precio_real_usd, precio_estimado_ia_usd, coordenadas_gps, fecha_publicacion,
            fichaprop_ruido, fichaprop_obras, fichaprop_subte, fichaprop_plazas, fichaprop_escuelas,
            fichaprop_comuna, fichaprop_resenas_cant
        ) VALUES (
            $1, $2, 'venta', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
            $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35,
            $36, $37, $38, $39, $40, $41, $42
        )
        ON CONFLICT (id_propiedad) DO UPDATE SET
            url = EXCLUDED.url,
            tipo_operacion = 'venta',
            tipo_propiedad = COALESCE(EXCLUDED.tipo_propiedad, propiedades.tipo_propiedad),
            barrio_zona = CASE
                WHEN EXCLUDED.barrio_zona IS NOT NULL AND EXCLUDED.barrio_zona <> 'Capital Federal'
                    THEN EXCLUDED.barrio_zona
                ELSE COALESCE(propiedades.barrio_zona, EXCLUDED.barrio_zona)
            END,
            direccion = COALESCE(EXCLUDED.direccion, propiedades.direccion),
            ambientes = CASE WHEN EXCLUDED.ambientes > 1 OR propiedades.ambientes IS NULL THEN EXCLUDED.ambientes ELSE propiedades.ambientes END,
            dormitorios = CASE WHEN EXCLUDED.dormitorios > 1 OR propiedades.dormitorios IS NULL THEN EXCLUDED.dormitorios ELSE propiedades.dormitorios END,
            banos = CASE WHEN EXCLUDED.banos > 1 OR propiedades.banos IS NULL THEN EXCLUDED.banos ELSE propiedades.banos END,
            superficie_total_m2 = COALESCE(EXCLUDED.superficie_total_m2, propiedades.superficie_total_m2),
            superficie_cubierta_m2 = COALESCE(EXCLUDED.superficie_cubierta_m2, propiedades.superficie_cubierta_m2),
            estado = COALESCE(EXCLUDED.estado, propiedades.estado),
            anios_de_antiguedad = COALESCE(EXCLUDED.anios_de_antiguedad, propiedades.anios_de_antiguedad),
            piso = COALESCE(EXCLUDED.piso, propiedades.piso),
            orientacion = COALESCE(NULLIF(EXCLUDED.orientacion, 'No especificada'), propiedades.orientacion),
            disposicion = COALESCE(NULLIF(EXCLUDED.disposicion, 'No especificada'), propiedades.disposicion),
            cochera = EXCLUDED.cochera OR propiedades.cochera,
            balcon = EXCLUDED.balcon OR propiedades.balcon,
            terraza = EXCLUDED.terraza OR propiedades.terraza,
            patio = EXCLUDED.patio OR propiedades.patio,
            pileta = EXCLUDED.pileta OR propiedades.pileta,
            parrilla = EXCLUDED.parrilla OR propiedades.parrilla,
            seguridad_24hs = EXCLUDED.seguridad_24hs OR propiedades.seguridad_24hs,
            ascensor = EXCLUDED.ascensor OR propiedades.ascensor,
            expensas_ars = CASE WHEN EXCLUDED.expensas_ars > 0 THEN EXCLUDED.expensas_ars ELSE propiedades.expensas_ars END,
            baulera = EXCLUDED.baulera OR propiedades.baulera,
            sum = EXCLUDED.sum OR propiedades.sum,
            seguridad_tipo = COALESCE(NULLIF(EXCLUDED.seguridad_tipo, 'Ninguno'), propiedades.seguridad_tipo),
            camara = EXCLUDED.camara OR propiedades.camara,
            gym = EXCLUDED.gym OR propiedades.gym,
            lounge = EXCLUDED.lounge OR propiedades.lounge,
            laundry = EXCLUDED.laundry OR propiedades.laundry,
            precio_real_usd = COALESCE(EXCLUDED.precio_real_usd, propiedades.precio_real_usd),
            precio_estimado_ia_usd = COALESCE(EXCLUDED.precio_estimado_ia_usd, propiedades.precio_estimado_ia_usd),
            coordenadas_gps = CASE
                WHEN EXCLUDED.coordenadas_gps IS NOT NULL THEN EXCLUDED.coordenadas_gps
                WHEN propiedades.coordenadas_gps::text LIKE '%-34.6037%' AND propiedades.coordenadas_gps::text LIKE '%-58.3816%' THEN NULL
                ELSE propiedades.coordenadas_gps
            END,
            fecha_publicacion = COALESCE(EXCLUDED.fecha_publicacion, propiedades.fecha_publicacion),
            fichaprop_ruido = COALESCE(EXCLUDED.fichaprop_ruido, propiedades.fichaprop_ruido),
            fichaprop_obras = COALESCE(EXCLUDED.fichaprop_obras, propiedades.fichaprop_obras),
            fichaprop_subte = COALESCE(EXCLUDED.fichaprop_subte, propiedades.fichaprop_subte),
            fichaprop_plazas = COALESCE(EXCLUDED.fichaprop_plazas, propiedades.fichaprop_plazas),
            fichaprop_escuelas = COALESCE(EXCLUDED.fichaprop_escuelas, propiedades.fichaprop_escuelas),
            fichaprop_comuna = COALESCE(EXCLUDED.fichaprop_comuna, propiedades.fichaprop_comuna),
            fichaprop_resenas_cant = COALESCE(EXCLUDED.fichaprop_resenas_cant, propiedades.fichaprop_resenas_cant);
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
            const precioVisible = el && (el.innerText || el.textContent || '').trim().length > 0;
            const estadoConPrecio = Array.from(document.querySelectorAll('script')).some(script => {
                const t = script.textContent || '';
                return t.includes('__INITIAL_STATE__') && t.includes('priceOperationTypes');
            });
            const schemaConPrecio = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).some(script => {
                const t = script.textContent || '';
                return t.includes('price') && t.includes('offers');
            });
            return Boolean(precioVisible || estadoConPrecio || schemaConPrecio);
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

        // Resolver GPS antes de llamar a la IA para que el modelo use la ubicación real.
        const coordsFinales = await resolverCoordsFinales(data, propiedadData);
        if (coordsFinales) {
            propiedadData.latitud = coordsFinales.lat;
            propiedadData.longitud = coordsFinales.lng;
        }

        const fp = propiedadData.direccion ? await consultarFichaprop(context, propiedadData.direccion) : null;
        if (!propiedadData.direccion) {
            console.warn(`[Fichaprop] ${id_propiedad}: no se consulta porque el scraper no encontró una dirección válida.`);
        }
        const resultadoIA = await estimarPrecioIA(propiedadData);

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

        const { rows } = await pool.query(`
            SELECT id_propiedad, tipo_operacion, direccion, barrio_zona, coordenadas_gps,
                   superficie_total_m2, superficie_cubierta_m2
            FROM propiedades
        `);
        const existentes = new Map(rows.map(r => [r.id_propiedad, r]));
        let procesadas = 0;
        let nuevas = 0;
        let reparadas = 0;

        const estaIncompleta = (fila) => {
            if (!fila) return false;
            if (fila.tipo_operacion !== 'venta') return true;
            if (!fila.direccion || esTituloNoDireccion(fila.direccion)) return true;
            if (!fila.superficie_total_m2 || !fila.superficie_cubierta_m2) return true;
            try {
                const gps = typeof fila.coordenadas_gps === 'string' ? JSON.parse(fila.coordenadas_gps) : fila.coordenadas_gps;
                if (!gps || !esCoordenadaConcreta(Number(gps.lat), Number(gps.lng))) return true;
            } catch { return true; }
            return false;
        };

        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            const idMatch = link.match(/\-(\d+)\.html/);
            const id_propiedad = idMatch ? `zp-${idMatch[1]}` : null;
            if (!id_propiedad) continue;

            const existente = existentes.get(id_propiedad);
            if (existente && !estaIncompleta(existente)) {
                console.log(`[${i + 1}/${links.length}] ${id_propiedad}: ya existe y parece completa. Omitida.`);
                continue;
            }
            if (existente) console.log(`[${i + 1}/${links.length}] ${id_propiedad}: datos incompletos; se vuelve a extraer para repararlos.`);

            const guardada = await procesarPropiedad(context, link, id_propiedad, i + 1, links.length);
            if (guardada) {
                procesadas++;
                if (existente) reparadas++;
                else nuevas++;
            }
        }

        console.log(`Finalizado. Nuevas: ${nuevas}. Reparadas: ${reparadas}. Total procesadas: ${procesadas}.`);

        if (procesadas > 0) {
            try {
                await fetch(`${CONFIG.IA_URL}/reentrenar`, { method: 'POST', headers: headersIA() });
            } catch {
                // opcional
            }
        }

    } catch (e) {
        console.error(`Error general: ${e.message}`);
    } finally {
        if (browser) await browser.close();
        await pool.end();
    }
})();