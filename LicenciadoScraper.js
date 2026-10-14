import 'dotenv/config';
import { chromium } from 'playwright';
import { Pool } from '@neondatabase/serverless';

dotenv.config({ path: '.env.local' });
dotenv.config();

const connectionString = 
    process.env.SpatialValueStorage_DATABASE_URL || 
    process.env.DATABASE_URL || 
    process.env.NEON_DATABASE_URL;

if (!connectionString) {
    console.error('❌ Error: No se encontró ninguna variable de conexión a la base de datos (SpatialValueStorage_DATABASE_URL o DATABASE_URL) en el archivo .env o .env.local');
    process.exit(1);
}

const pool = new Pool({ connectionString: process.env.SpatialValueStorage_DATABASE_URL });
const IA_URL = process.env.IA_URL || 'http://127.0.0.1:8000';


const waitForAny = async (page, selectors, timeout = 15000) => {
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

    return new Date().toISOString().split('T')[0];
};

const normalizarDireccionFichaprop = (direccion) => {
    if (!direccion) return null;
    return direccion
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/\bav\.?\b/g, 'avenida')
        .replace(/\bpje\.?\b/g, 'pasaje')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
};

const consultarFichaprop = async (context, direccion) => {
    const slug = normalizarDireccionFichaprop(direccion);
    if (!slug) return null;

    const urlFichaprop = `https://fichaprop.ar/edificio/${slug}`;
    const pageFP = await context.newPage();

    try {
        const response = await pageFP.goto(urlFichaprop, { waitUntil: 'domcontentloaded', timeout: 20000 });
        if (!response || response.status() === 404) return null;

        await pageFP.waitForTimeout(1000);

        const datosFichaprop = await pageFP.evaluate(() => {
            const textoCompleto = document.body ? document.body.innerText : '';
            if (textoCompleto.includes("No encontramos este edificio")) return null;

            const spans = Array.from(document.querySelectorAll('span'));
            const comunaSpan = spans.find(s => (s.textContent || s.innerText || '').includes('Comuna'));
            const comunaText = comunaSpan ? (comunaSpan.textContent || comunaSpan.innerText).trim() : null;

            const obtenerTextoBloque = (palabraClave) => {
                const elementos = Array.from(document.querySelectorAll('div, section, article, p, span'));
                for (const el of elementos) {
                    const txt = (el.innerText || el.textContent || '').trim();
                    if (txt.includes(palabraClave) && txt.length < 150) {
                        return txt.replace(/\n/g, ' - ');
                    }
                }
                return null;
            };

            const matchResenas = textoCompleto.match(/(\d+)\s*reseñas/i);

            return {
                ruido: obtenerTextoBloque('dBA') || null,
                obras: obtenerTextoBloque('obras') || null,
                subte: obtenerTextoBloque('subte') || null,
                plazas: obtenerTextoBloque('plazas') || null,
                escuelas: obtenerTextoBloque('escuelas') || null,
                comuna: comunaText,
                resenas: matchResenas ? parseInt(matchResenas[1], 10) : 0
            };
        });

        return datosFichaprop;
    } catch {
        return null;
    } finally {
        await pageFP.close().catch(() => {});
    }
};

(async () => {
    let browser;
    try {
        browser = await chromium.connectOverCDP('http://localhost:9222');
    } catch {
        console.error('Error CDP localhost:9222');
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
                await page.goto(urlPagina, { waitUntil: 'domcontentloaded', timeout: 45000 });

                const selectorListado = await waitForAny(page, [
                    '[data-qa="posting-card"]', '[data-posting-id]', 'div[class*="posting-card"]', 'ol[class*="postings"] li', 'article'
                ], 20000);

                if (!selectorListado) break;

                await page.waitForTimeout(1000);

                const linksPagina = await page.evaluate(() =>
                    Array.from(document.querySelectorAll('a[href]'))
                        .map(a => a.href)
                        .filter(h => h.includes('zonaprop.com.ar') && h.match(/\/propiedades\/.*\.html/) && !h.includes('#'))
                );

                linksTotales.push(...linksPagina);

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
                const response = await detailPage.goto(link, { waitUntil: 'domcontentloaded', timeout: 35000 });
                
                const tituloPagina = await detailPage.title();
                if ((response && (response.status() === 403 || response.status() === 429)) || 
                    tituloPagina.includes('Cloudflare') || tituloPagina.includes('Attention Required')) {
                    await detailPage.close().catch(() => {});
                    continue;
                }

                await waitForAny(detailPage, ['[class*="price"]', '[class*="Price"]', '[data-qa="price"]'], 10000);

                await detailPage.evaluate(async () => {
                    window.scrollTo(0, document.body.scrollHeight / 2);
                    await new Promise(r => setTimeout(r, 200));
                    window.scrollTo(0, document.body.scrollHeight);
                });

                const textoFechaNodo = await detailPage.evaluate(() => {
                    const todos = Array.from(document.querySelectorAll('*'));
                    const coincidencia = todos.find(n => n.children.length === 0 && /publicado\s+hace/i.test(n.innerText || ''));
                    if (coincidencia) return coincidencia.innerText;

                    const match = document.body.innerText.match(/publicado\s+hace\s+\d+\s*(?:día|días|dia|dias|mes|meses|año|años|ano|anos)/i);
                    return match ? match[0] : '';
                });

                const fechaPublicacionCalculada = calcularFechaPublicacion(textoFechaNodo);

                let textoPestanasAcumulado = '';
                const pestañas = ['Características generales', 'Ambientes', 'Servicios', 'Instalaciones'];
                for (const pestana of pestañas) {
                    const selectorTab = detailPage.locator(`button:has-text("${pestana}"), [role="tab"]:has-text("${pestana}")`).first();
                    if (await selectorTab.isVisible().catch(() => false)) {
                        await selectorTab.click({ force: true }).catch(() => {});
                        await detailPage.waitForTimeout(200);
                        const txt = await detailPage.evaluate(() => document.body ? document.body.innerText : '');
                        textoPestanasAcumulado += ' ' + txt;
                    }
                }

                const data = await detailPage.evaluate((textoAdicionalTabs) => {
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
                                const posting = state.posting || (state.postings && state.postings[0]);
                                if (posting) {
                                    latitudState = posting.postingLocation?.geolocation?.latitude || null;
                                    longitudState = posting.postingLocation?.geolocation?.longitude || null;
                                    direccionState = posting.postingLocation?.address || posting.postingLocation?.name || null;
                                    barrioState = posting.postingLocation?.location?.name || null;
                                    const priceObj = posting.priceOperationTypes?.[0]?.prices?.[0];
                                    if (priceObj) {
                                        precioState = `${priceObj.currency || ''} ${priceObj.amount || ''}`;
                                    }
                                }
                            }
                        }
                    } catch(e) {}

                    const textoCompleto = ((document.body ? document.body.innerText : '') + ' ' + (textoAdicionalTabs || ''));
                    const textoLower = textoCompleto.toLowerCase();
                    const elTitulo = document.querySelector('h1,[data-qa="title"],[class*="TitleContainer"]');
                    const tituloTexto = elTitulo ? (elTitulo.innerText || elTitulo.textContent || '').trim().toLowerCase() : '';

                    let esEnConstruccion = false;
                    if (textoLower.includes('en construcción') || textoLower.includes('en construccion') ||
                        textoLower.includes('en pozo') || textoLower.includes('emprendimiento') || textoLower.includes('al pozo')) {
                        esEnConstruccion = true;
                    }

                    let direccion = direccionState;
                    let barrio_zona = barrioState || 'Capital Federal';
                    const elDireccionDOM = document.querySelector('[data-qa="location"], [class*="Location"], h2[class*="title"]');
                    if (!direccion && elDireccionDOM) {
                        direccion = (elDireccionDOM.innerText || elDireccionDOM.textContent || '').trim();
                    }

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
                        } else if (txtLower.includes('antigüe') || txtLower.includes('antigue') || txtLower.includes('año')) {
                            const m = txt.match(/(\d+)/);
                            if (m) anios_de_antiguedad = parseInt(m[1], 10);
                        }

                        if (txtLower === 'frente') disposicion = 'Frente';
                        if (txtLower === 'contrafrente') disposicion = 'Contrafrente';

                        if (['N', 'S', 'E', 'O', 'NE', 'NO', 'SE', 'SO'].includes(txt.toUpperCase())) {
                            orientacion = txt.toUpperCase();
                        }
                    });

                    let precioUSD = precioState;
                    if (!precioUSD) {
                        const byQa = document.querySelector('[data-qa="price"]');
                        precioUSD = byQa ? (byQa.innerText || byQa.textContent || '').trim() : '';
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
                        longitud: longitudState
                    };
                }, textoPestanasAcumulado);

                const precio_real_usd = parsearPrecioUSD(data.precioUSD);
                if (!precio_real_usd) continue;

                const check = (...words) => words.some(w => data.textoLower.includes(w));

                let estadoFinal = 'Usado';
                if (data.esEnConstruccion) {
                    estadoFinal = 'En construcción';
                } else if (data.anios_de_antiguedad === 0) {
                    estadoFinal = 'A estrenar';
                }

                const propiedadData = {
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
                    laundry: check('laundry', 'lavadero')
                };

                let datosFP = null;
                if (propiedadData.direccion) {
                    datosFP = await consultarFichaprop(context, propiedadData.direccion);
                }

                let resultadoIA = {};
                try {
                    const resIA = await fetch(`${IA_URL}/estimar-precio`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(propiedadData)
                    });
                    if (resIA.ok) resultadoIA = await resIA.json();
                } catch {}

                const coordsFinales = (data.latitud && data.longitud)
                    ? { lat: data.latitud, lng: data.longitud }
                    : (resultadoIA.coordenadas || null);

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

                const values = [
                    id_propiedad,
                    link,
                    propiedadData.tipo_propiedad,
                    propiedadData.barrio_zona,
                    propiedadData.direccion,
                    propiedadData.ambientes,
                    propiedadData.dormitorios,
                    propiedadData.banos,
                    propiedadData.superficie_total_m2,
                    propiedadData.superficie_cubierta_m2,
                    propiedadData.estado,
                    propiedadData.anios_de_antiguedad,
                    propiedadData.piso,
                    propiedadData.orientacion,
                    propiedadData.disposicion,
                    propiedadData.cochera,
                    propiedadData.balcon,
                    propiedadData.terraza,
                    propiedadData.patio,
                    propiedadData.pileta,
                    propiedadData.parrilla,
                    propiedadData.seguridad_24hs,
                    propiedadData.ascensor,
                    propiedadData.expensas_ars,
                    propiedadData.baulera,
                    propiedadData.sum,
                    propiedadData.seguridad_tipo,
                    propiedadData.camara,
                    propiedadData.gym,
                    propiedadData.lounge,
                    propiedadData.laundry,
                    precio_real_usd,
                    resultadoIA.precio_estimado_usd || null,
                    coordsFinales ? JSON.stringify(coordsFinales) : null,
                    fechaPublicacionCalculada,
                    datosFP?.ruido || null,
                    datosFP?.obras || null,
                    datosFP?.subte || null,
                    datosFP?.plazas || null,
                    datosFP?.escuelas || null,
                    datosFP?.comuna || null,
                    datosFP?.resenas || 0
                ];

                await pool.query(query, values);
                nuevos++;

                await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));

            } catch (err) {
                console.error(`Error procesando ${id_propiedad}: ${err.message}`);
            } finally {
                await detailPage.close().catch(() => {});
            }
        }

        if (nuevos > 0) {
            try {
                await fetch(`${IA_URL}/reentrenar`, { method: 'POST' });
            } catch {}
        }

    } catch (e) {
        console.error(`Error general: ${e.message}`);
    } finally {
        if (browser) await browser.close();
        await pool.end();
    }
})();