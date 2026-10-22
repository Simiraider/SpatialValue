
import 'dotenv/config';
import { firefox } from 'playwright';
import ws from 'ws';
import { Pool, neonConfig } from '@neondatabase/serverless';

neonConfig.webSocketConstructor = ws;

const DATABASE_URL = process.env.SpatialValueStorage_DATABASE_URL;
const IA_URL = process.env.IA_URL || 'http://127.0.0.1:8000';

if (!DATABASE_URL) {
    throw new Error(
        'Falta SpatialValueStorage_DATABASE_URL en el archivo .env.local'
    );
}

const pool = new Pool({ connectionString: DATABASE_URL });

const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

const fechaLocalArgentina = (diasAtras = 0) => {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() - diasAtras);

    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(fecha);
};

// Espera los selectores de a uno, sin esperar a que terminen todos.
const waitForAny = async (page, selectors, timeout = 15000) => {
    const inicio = Date.now();

    for (const selector of selectors) {
        const restante = timeout - (Date.now() - inicio);
        if (restante <= 0) break;

        try {
            await page.locator(selector).first().waitFor({
                state: 'attached',
                timeout: Math.min(restante, 2500)
            });

            return selector;
        } catch {
            // Probar el siguiente selector.
        }
    }

    return null;
};

const parsearPrecioUSD = texto => {
    if (!texto) return 0;

    const match =
        texto.match(/(?:USD|U\$S|US\$)\s*([\d.,]+)/i) ||
        texto.match(/\$\s*([\d.,]+)/) ||
        texto.match(/([\d.,]+)/);

    if (!match) return 0;

    let valorTexto = match[1].trim();

    // En los portales inmobiliarios, $1.250.000 suele indicar
    // un millón doscientos cincuenta mil.
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(valorTexto)) {
        valorTexto = valorTexto.replace(/\./g, '').replace(',', '.');
    } else if (/^\d+,\d{3}$/.test(valorTexto)) {
        valorTexto = valorTexto.replace(',', '');
    } else {
        valorTexto = valorTexto.replace(/,/g, '');
    }

    const valor = Number(valorTexto);

    return Number.isFinite(valor) && valor >= 100 && valor <= 20000000
        ? Math.round(valor)
        : 0;
};

const calcularFechaPublicacion = textoFecha => {
    if (!textoFecha) return null;

    const limpio = textoFecha.replace(/\s+/g, ' ').trim();

    const match = limpio.match(
        /(?:publicado\s+)?hace\s+(\d+)\s*(día|días|dia|dias|mes|meses|año|años|ano|anos)/i
    );

    if (match) {
        const numero = parseInt(match[1], 10);
        const unidad = match[2].toLowerCase();

        let dias = numero;

        if (unidad.startsWith('mes')) dias = numero * 30;
        if (unidad.startsWith('año') || unidad.startsWith('ano')) {
            dias = numero * 365;
        }

        return fechaLocalArgentina(dias);
    }

    if (/publicado\s+hoy/i.test(limpio)) return fechaLocalArgentina();
    if (/publicado\s+ayer/i.test(limpio)) return fechaLocalArgentina(1);

    return null;
};

// ============================================================
// OPENSTREETMAP / NOMINATIM
// ============================================================

const geocodificarDireccion = async (direccion, barrio) => {
    if (!direccion) return null;

    const consulta = [
        direccion,
        barrio && barrio !== 'Capital Federal' ? barrio : null,
        'Ciudad Autónoma de Buenos Aires',
        'Argentina'
    ].filter(Boolean).join(', ');

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', consulta);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'ar');
    url.searchParams.set('addressdetails', '1');

    try {
        const respuesta = await fetch(url, {
            headers: {
                'User-Agent': 'SpatialValue/1.0 (property geocoding)',
                'Accept-Language': 'es-AR,es'
            },
            signal: AbortSignal.timeout(10000)
        });

        if (!respuesta.ok) {
            console.warn(`Nominatim respondió HTTP ${respuesta.status}`);
            return null;
        }

        const resultados = await respuesta.json();

        if (!Array.isArray(resultados) || resultados.length === 0) {
            console.warn(`No se encontraron coordenadas: ${consulta}`);
            return null;
        }

        const lat = Number(resultados[0].lat);
        const lng = Number(resultados[0].lon);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

        console.log(`Coordenadas OSM obtenidas para: ${direccion}`);

        return { lat, lng };
    } catch (error) {
        console.warn(`Error de geocodificación: ${error.message}`);
        return null;
    }
};

// ============================================================
// EXTRAER INFORMACIÓN DE UNA PROPIEDAD
// ============================================================

const extraerPropiedad = async (page) => {
    return page.evaluate(() => {
        const cuerpo = document.body?.innerText || '';
        const texto = cuerpo.replace(/\s+/g, ' ').trim();
        const lower = texto.toLowerCase();

        const textoElemento = selector => {
            const elemento = document.querySelector(selector);
            return elemento
                ? (elemento.innerText || elemento.textContent || '').trim()
                : '';
        };

        const buscarNumero = regex => {
            const match = texto.match(regex);
            return match ? Number.parseInt(match[1], 10) : null;
        };

        const titulo = textoElemento('h1,[data-qa="title"]');
        let direccion = null;
        let barrio = 'Capital Federal';
        let latitud = null;
        let longitud = null;
        let precio = '';

        // Intentar recuperar el estado inicial del portal.
        try {
            for (const script of document.querySelectorAll('script')) {
                const contenido = script.textContent || '';

                if (!contenido.includes('__INITIAL_STATE__')) continue;

                const match = contenido.match(
                    /__INITIAL_STATE__\s*=\s*({.*?});/s
                );

                if (!match) continue;

                const estado = JSON.parse(match[1]);
                const posting = estado.posting || estado.postings?.[0];

                if (!posting) continue;

                const ubicacion = posting.postingLocation || {};

                latitud =
                    ubicacion.geolocation?.latitude ??
                    ubicacion.latitude ??
                    null;

                longitud =
                    ubicacion.geolocation?.longitude ??
                    ubicacion.longitude ??
                    null;

                direccion = ubicacion.address || ubicacion.name || null;
                barrio = ubicacion.location?.name || barrio;

                const precioObjeto =
                    posting.priceOperationTypes?.[0]?.prices?.[0];

                if (precioObjeto) {
                    precio = `${precioObjeto.currency || ''} ${precioObjeto.amount || ''}`.trim();
                }

                break;
            }
        } catch {
            // El portal puede utilizar otro formato de estado.
        }

        // Ubicación visible como alternativa.
        if (!direccion) {
            const ubicacion = textoElemento(
                '#map-section h4, [class*="section-location-property"] h4'
            );

            if (ubicacion) {
                const partes = ubicacion.split(',').map(x => x.trim());
                direccion = partes[0] || null;
                barrio = partes[1] || barrio;
            }
        }

        // Coordenadas dentro de los scripts.
        if (latitud == null || longitud == null) {
            for (const script of document.querySelectorAll('script')) {
                const contenido = script.textContent || '';

                const lat = contenido.match(
                    /"latitude"\s*:\s*(-?\d+(?:\.\d+)?)/ 
                );

                const lng = contenido.match(
                    /"longitude"\s*:\s*(-?\d+(?:\.\d+)?)/ 
                );

                if (lat && lng) {
                    latitud = Number(lat[1]);
                    longitud = Number(lng[1]);
                    break;
                }
            }
        }

        // Precio visible.
        if (!precio) {
            precio = textoElemento(
                '[data-qa="price"], [class*="Price"], [class*="price"]'
            );
        }

        // Extraer características de las tarjetas principales.
        let superficieTotal = null;
        let superficieCubierta = null;
        let ambientes = null;
        let dormitorios = null;
        let banos = null;
        let antiguedad = null;
        let cantidadPisos = null;

        const caracteristicas = Array.from(
            document.querySelectorAll(
                '[class*="icon-feature"], [class*="section-icon-features"] li, [data-qa="main-features"] > div, [class*="MainFeatures"] > div'
            )
        ).map(el => (el.innerText || '').trim());

        // Si los selectores cambian, el texto general sigue sirviendo
        // como alternativa para varias características.
        for (const caracteristica of caracteristicas) {
            const t = caracteristica.toLowerCase();
            const numero = caracteristica.match(/\d+/);
            const n = numero ? Number(numero[0]) : null;

            if (
                t.includes('m² cub') ||
                t.includes('m2 cub') ||
                t.includes('cubierta')
            ) {
                if (n !== null) superficieCubierta = n;
            } else if (t.includes('m²') || t.includes('m2')) {
                if (n !== null) superficieTotal = n;
            }

            if (t.includes('amb') && n !== null) ambientes = n;
            if (t.includes('dorm') && n !== null) dormitorios = n;
            if (t.includes('baño') && n !== null) banos = n;
            if (
                (t.includes('planta') || t.includes('nivel') || t.includes('pisos')) &&
                n !== null
            ) {
                cantidadPisos = n;
            }

            if (/estrenar/i.test(t)) antiguedad = 0;
            else if (/antigüedad|antiguedad|años|años de antigüedad/i.test(t) && n !== null) {
                antiguedad = n;
            }
        }

        if (superficieTotal === null) {
            superficieTotal = buscarNumero(/superficie total\s*:?\s*(\d+)/i);
        }

        if (superficieCubierta === null) {
            superficieCubierta = buscarNumero(/superficie cubierta\s*:?\s*(\d+)/i);
        }

        if (ambientes === null) ambientes = buscarNumero(/(\d+)\s*ambientes/i);
        if (dormitorios === null) dormitorios = buscarNumero(/(\d+)\s*dormitorios/i);
        if (banos === null) banos = buscarNumero(/(\d+)\s*baños/i);

        if (!superficieTotal && superficieCubierta) {
            superficieTotal = superficieCubierta;
        }

        if (!superficieCubierta && superficieTotal) {
            superficieCubierta = superficieTotal;
        }

        let tipoPropiedad = 'Casa';

        const url = location.href.toLowerCase();
        const tituloLower = titulo.toLowerCase();

        if (url.includes('/departamentos-') || tituloLower.startsWith('departamento')) {
            tipoPropiedad = 'Departamento';
        } else if (url.includes('/ph-') || tituloLower.startsWith('ph')) {
            tipoPropiedad = 'PH';
        }

        const enConstruccion =
            /en construcción|en construccion|en pozo|emprendimiento|en obra|al pozo/i.test(lower);

        let codigoAnunciante = null;
        const cod = texto.match(/cód\.\s*del\s*anunciante:\s*([^|\n\r]+)/i);
        if (cod) codigoAnunciante = cod[1].trim();

        let calificacion = null;
        const score = document.querySelector(
            '[class*="score-title"], [class*="scoreTitle"], [class*="scoreLevel"]'
        );

        if (score) {
            const m = (score.innerText || '').match(/\d+/);
            if (m) calificacion = Number(m[0]);
        }

        const fechaMatch = texto.match(
            /publicado\s+(?:hace\s+\d+\s*(?:días?|dias?|mes(?:es)?|años?|anos?)|hoy|ayer)/i
        );

        const expensasMatch = texto.match(
            /expensas?[:\s$]*([\d.]+(?:,\d+)?)/i
        );

        const expensas = expensasMatch
            ? Number.parseInt(expensasMatch[1].replace(/\./g, '').replace(',', ''), 10) || 0
            : 0;

        const orientacionMatch = texto.match(
            /orientación\s*:?\s*(norte|sur|este|oeste|noreste|noroeste|sudeste|sudoeste)/i
        );

        const disposicion = /\bcontrafrente\b/i.test(lower)
            ? 'Contrafrente'
            : /\bfrente\b/i.test(lower)
                ? 'Frente'
                : 'No especificada';

        return {
            titulo,
            textoCompleto: cuerpo,
            textoLower: lower,
            direccion,
            barrio,
            latitud,
            longitud,
            precio,
            tipoPropiedad,
            superficieTotal,
            superficieCubierta,
            ambientes,
            dormitorios,
            banos,
            antiguedad,
            enConstruccion,
            cantidadPisos,
            codigoAnunciante,
            calificacion,
            fechaTexto: fechaMatch?.[0] || '',
            expensas,
            orientacion: orientacionMatch?.[1] || 'No especificada',
            disposicion,
            luminosidad: /luminoso/i.test(lower) ? 'Luminoso' : 'No especificada'
        };
    });
};

// ============================================================
// FLUJO PRINCIPAL
// ============================================================

(async () => {
    console.log('Iniciando scraper SpatialValue sin proxy premium...');

    let browser;
    let context;

    try {
        browser = await firefox.launch({
            headless: true
        });

        browser.on('disconnected', () => {
            console.error('ERROR: Firefox se desconectó inesperadamente.');
        });

        context = await browser.newContext({
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
            locale: 'es-AR',
            timezoneId: 'America/Argentina/Buenos_Aires',
            viewport: { width: 1366, height: 768 }
        });

        const page = await context.newPage();

        page.on('crash', () => {
            console.error('ERROR: la página principal sufrió un crash.');
        });

        page.on('close', () => {
            console.error('AVISO: la página principal se cerró.');
        });

        const PAGINAS_MAXIMAS = 10;
        const TIPO_OPERACION = 'venta';

        const linksTotales = [];

        // --------------------------------------------------------
        // 1. RECORRER LISTADOS
        // --------------------------------------------------------

        for (let pagina = 1; pagina <= PAGINAS_MAXIMAS; pagina++) {
            if (!browser.isConnected()) {
                console.error('Firefox ya no está conectado. Se detiene el listado.');
                break;
            }

            const url = pagina === 1
                ? `https://www.zonaprop.com.ar/casas-${TIPO_OPERACION}-capital-federal.html`
                : `https://www.zonaprop.com.ar/casas-${TIPO_OPERACION}-capital-federal-pagina-${pagina}.html`;

            try {
                console.log(`Cargando página ${pagina}: ${url}`);

                const response = await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: 45000
                });

                console.log(
                    `Página ${pagina}: HTTP ${response?.status() ?? 'sin respuesta'}`
                );

                if (response && [403, 429].includes(response.status())) {
                    console.warn('Zonaprop respondió con bloqueo o límite de solicitudes.');
                    break;
                }

                console.log(`Título: ${await page.title()}`);
                console.log(`URL final: ${page.url()}`);

                await esperar(1800);

                const selector = await waitForAny(page, [
                    '[data-qa="posting-card"]',
                    '[data-posting-id]',
                    'div[class*="posting-card"]',
                    'ol[class*="postings"] li',
                    'article',
                    'a[href*="/propiedades/"]'
                ], 12000);

                if (!selector) {
                    console.warn(`No se encontró el listado en página ${pagina}.`);
                    break;
                }

                const linksPagina = await page.evaluate(() =>
                    Array.from(document.querySelectorAll('a[href]'))
                        .map(a => a.href.split('#')[0])
                        .filter(h =>
                            h.includes('zonaprop.com.ar') &&
                            /\/propiedades\/.*\.html(?:\?.*)?$/.test(h)
                        )
                );

                linksTotales.push(...linksPagina);

                console.log(
                    `Página ${pagina}: ${linksPagina.length} enlaces encontrados.`
                );

                if (linksPagina.length === 0) {
                    console.warn(
                        'Se encontró contenido, pero no enlaces de propiedades. Puede haber cambiado la página.'
                    );
                    break;
                }

                await esperar(2000 + Math.random() * 1000);
            } catch (error) {
                console.error(`Error en listado ${pagina}: ${error.message}`);

                if (!browser.isConnected()) {
                    console.error('Firefox se cerró. Se detiene el scraper.');
                    break;
                }
            }
        }

        const links = [...new Set(linksTotales)];

        console.log(`Se encontraron ${links.length} enlaces únicos.`);

        if (links.length === 0) {
            console.warn(
                'No hay propiedades para procesar. Revisá el HTTP, el título y la URL que aparecieron arriba.'
            );
            return;
        }

        // --------------------------------------------------------
        // 2. CONSULTAR PROPIEDADES EXISTENTES
        // --------------------------------------------------------

        const { rows } = await pool.query(
            'SELECT id_propiedad FROM propiedades'
        );

        const idsProcesados = new Set(rows.map(row => row.id_propiedad));
        let nuevos = 0;

        // --------------------------------------------------------
        // 3. PROCESAR CADA PROPIEDAD
        // --------------------------------------------------------

        for (let i = 0; i < links.length; i++) {
            if (!browser.isConnected()) {
                console.error('Firefox se desconectó. No se pueden procesar más propiedades.');
                break;
            }

            const link = links[i];
            const idMatch = link.match(/-(\d+)\.html(?:\?.*)?$/);
            const id_propiedad = idMatch ? `zp-${idMatch[1]}` : null;

            if (!id_propiedad || idsProcesados.has(id_propiedad)) {
                continue;
            }

            console.log(`[${i + 1}/${links.length}] Procesando ${id_propiedad}`);

            const detailPage = await context.newPage();

            try {
                detailPage.on('crash', () => {
                    console.error(`La pestaña de ${id_propiedad} sufrió un crash.`);
                });

                const response = await detailPage.goto(link, {
                    waitUntil: 'domcontentloaded',
                    timeout: 45000
                });

                const tituloPagina = await detailPage.title();

                console.log(
                    `HTTP ${response?.status() ?? 'sin respuesta'} | ${tituloPagina}`
                );

                if (
                    (response && [403, 429].includes(response.status())) ||
                    /Just a moment|Attention Required|Access denied/i.test(tituloPagina)
                ) {
                    console.warn(`Posible bloqueo al consultar ${id_propiedad}.`);
                    await esperar(5000);
                    continue;
                }

                await esperar(1000);

                await waitForAny(detailPage, [
                    '[data-qa="price"]',
                    '[class*="price"]',
                    '[class*="Price"]',
                    'h1'
                ], 10000);

                const data = await extraerPropiedad(detailPage);

                const precioReal = parsearPrecioUSD(data.precio);

                if (!data.direccion && precioReal === 0) {
                    console.warn(
                        `Datos insuficientes para ${id_propiedad}; se omite para evitar guardar información incorrecta.`
                    );
                    continue;
                }

                const textoLower = data.textoLower;

                const check = (...palabras) =>
                    palabras.some(p => textoLower.includes(p));

                const tieneCamara = check(
                    'cámara', 'camara', 'cctv', 'circuito cerrado'
                );

                const tieneSeguridadFisica = check(
                    'seguridad', 'vigilancia', 'guardia', 'totem', 'encargado'
                );

                const seguridad24hs =
                    check('seguridad 24', 'vigilancia 24', '24hs', '24 hs', '24hrs') ||
                    tieneSeguridadFisica ||
                    tieneCamara;

                let estado = 'Usado';

                if (data.enConstruccion) {
                    estado = 'En construcción';
                } else if (data.antiguedad === 0) {
                    estado = 'A estrenar';
                }

                let coordenadas = null;

                const lat = Number(data.latitud);
                const lng = Number(data.longitud);

                if (
                    data.latitud != null &&
                    data.longitud != null &&
                    Number.isFinite(lat) &&
                    Number.isFinite(lng) &&
                    lat >= -90 && lat <= 90 &&
                    lng >= -180 && lng <= 180
                ) {
                    coordenadas = { lat, lng };
                }

                const propiedadData = {
                    tipo_propiedad: data.tipoPropiedad,
                    barrio_zona: data.barrio || 'Capital Federal',
                    ambientes: data.ambientes || 1,
                    dormitorios: data.dormitorios || 1,
                    banos: data.banos || 1,
                    superficie_total_m2: data.superficieTotal,
                    superficie_cubierta_m2: data.superficieCubierta,
                    estado,
                    anios_de_antiguedad: data.enConstruccion
                        ? 0
                        : data.antiguedad,
                    piso: data.tipoPropiedad === 'Casa'
                        ? null
                        : Number.parseInt(
                            textoLower.match(/piso\s*(\d+)/i)?.[1] || '0',
                            10
                        ) || null,
                    cantidad_pisos: data.cantidadPisos,
                    orientacion: data.orientacion,
                    disposicion: data.disposicion,
                    cochera: check('cochera', 'garage', 'estacionamiento'),
                    balcon: check('balcon', 'balcón'),
                    terraza: check('terraza'),
                    patio: check('patio'),
                    pileta: check('pileta', 'piscina'),
                    parrilla: check('parrilla', 'quincho'),
                    seguridad_24hs: seguridad24hs,
                    ascensor: check('ascensor', 'ascensores', 'elevador'),
                    expensas_ars: data.expensas,
                    baulera: check('baulera'),
                    sum: check('sum', 'salón de usos'),
                    seguridad_tipo: tieneSeguridadFisica ? 'Física' : 'Ninguno',
                    camara: tieneCamara,
                    gym: check('gym', 'gimnasio'),
                    lounge: check('lounge'),
                    laundry: check('laundry', 'lavadero')
                };

                // Consultar el modelo de IA.
                let resultadoIA = {};

                try {
                    const respuestaIA = await fetch(`${IA_URL}/estimar-precio`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-API-KEY': process.env.INTERNAL_API_KEY || ''
                        },
                        body: JSON.stringify({
                            ...propiedadData,
                            latitud: coordenadas?.lat ?? null,
                            longitud: coordenadas?.lng ?? null
                        }),
                        signal: AbortSignal.timeout(15000)
                    });

                    if (respuestaIA.ok) {
                        resultadoIA = await respuestaIA.json();
                    } else {
                        console.warn(`IA respondió HTTP ${respuestaIA.status}.`);
                    }
                } catch (error) {
                    console.warn(`No se pudo consultar la IA: ${error.message}`);
                }

                // Si Zonaprop no proporciona coordenadas, usar OSM.
                if (!coordenadas && data.direccion) {
                    coordenadas = await geocodificarDireccion(
                        data.direccion,
                        propiedadData.barrio_zona
                    );

                    // Nominatim requiere limitar la frecuencia de solicitudes.
                    await esperar(1100);
                }

                let precioEstimado = Number(
                    resultadoIA.precio_estimado_usd
                );

                if (!Number.isFinite(precioEstimado) || precioEstimado <= 0) {
                    precioEstimado = null;
                } else {
                    precioEstimado = Math.round(precioEstimado);
                }

                // Respaldo simple si la IA no devuelve un precio.
                if (
                    !precioEstimado &&
                    (
                        propiedadData.superficie_cubierta_m2 ||
                        propiedadData.superficie_total_m2
                    )
                ) {
                    const superficie =
                        propiedadData.superficie_cubierta_m2 ||
                        propiedadData.superficie_total_m2;

                    const barrio = propiedadData.barrio_zona.toLowerCase();

                    const valorM2 = [
                        'belgrano',
                        'recoleta',
                        'palermo',
                        'puerto madero'
                    ].some(nombre => barrio.includes(nombre))
                        ? 1650
                        : 1250;

                    precioEstimado = Math.round(superficie * valorM2);
                    console.log(`Se aplicó el precio de respaldo a ${id_propiedad}.`);
                }

                let codigoAnunciante = data.codigoAnunciante;
                const codigoLower = (codigoAnunciante || '').toLowerCase().trim();

                if (
                    !codigoAnunciante ||
                    codigoLower === '13' ||
                    codigoLower === 'acuña' ||
                    codigoLower.length < 3
                ) {
                    codigoAnunciante = `REF-${id_propiedad.replace('zp-', '')}`;
                }

                const fechaPublicacion =
                    calcularFechaPublicacion(data.fechaTexto) ||
                    fechaLocalArgentina();

                if (!data.fechaTexto) {
                    console.warn(
                        `No se detectó fecha de publicación para ${id_propiedad}; se usará la fecha actual.`
                    );
                }

                // Guardar en NeonDB.
                const query = `
                    INSERT INTO propiedades (
                        id_propiedad, url, tipo_operacion, fecha_publicacion,
                        direccion, barrio_zona, coordenadas_gps,
                        tipo_propiedad, ambientes, dormitorios, banos,
                        superficie_total_m2, superficie_cubierta_m2, piso,
                        estado, anios_de_antiguedad, orientacion, disposicion, luminosidad,
                        precio_real_usd, precio_estimado_ia_usd, expensas_ars,
                        cochera, balcon, terraza, patio, pileta, parrilla, ascensor, baulera,
                        sum, gym, lounge, laundry, seguridad_24hs, seguridad_tipo, camara,
                        codigo_anunciante, calificacion_usuarios
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7,
                        $8, $9, $10, $11, $12, $13, $14,
                        $15, $16, $17, $18, $19, $20, $21, $22,
                        $23, $24, $25, $26, $27, $28, $29, $30,
                        $31, $32, $33, $34, $35, $36, $37, $38, $39
                    )
                    ON CONFLICT (id_propiedad) DO NOTHING
                `;

                const values = [
                    id_propiedad,
                    link,
                    TIPO_OPERACION,
                    fechaPublicacion,
                    data.direccion,
                    propiedadData.barrio_zona,
                    coordenadas ? JSON.stringify(coordenadas) : null,
                    propiedadData.tipo_propiedad,
                    propiedadData.ambientes,
                    propiedadData.dormitorios,
                    propiedadData.banos,
                    propiedadData.superficie_total_m2,
                    propiedadData.superficie_cubierta_m2,
                    propiedadData.piso,
                    propiedadData.estado,
                    propiedadData.anios_de_antiguedad,
                    propiedadData.orientacion,
                    propiedadData.disposicion,
                    data.luminosidad,
                    precioReal,
                    precioEstimado,
                    propiedadData.expensas_ars,
                    propiedadData.cochera,
                    propiedadData.balcon,
                    propiedadData.terraza,
                    propiedadData.patio,
                    propiedadData.pileta,
                    propiedadData.parrilla,
                    propiedadData.ascensor,
                    propiedadData.baulera,
                    propiedadData.sum,
                    propiedadData.gym,
                    propiedadData.lounge,
                    propiedadData.laundry,
                    propiedadData.seguridad_24hs,
                    propiedadData.seguridad_tipo,
                    propiedadData.camara,
                    codigoAnunciante,
                    data.calificacion
                ];

                const insertado = await pool.query(query, values);

                if (insertado.rowCount > 0) {
                    nuevos++;
                    idsProcesados.add(id_propiedad);

                    console.log(
                        `Guardado ${id_propiedad} | ` +
                        `Barrio: ${propiedadData.barrio_zona} | ` +
                        `Superficie: ${propiedadData.superficie_total_m2 ?? 'N/D'} m² | ` +
                        `Antigüedad: ${propiedadData.anios_de_antiguedad ?? 'N/D'} | ` +
                        `Precio: USD ${precioReal || 'N/D'} | ` +
                        `Coordenadas: ${coordenadas ? 'Sí' : 'No'}`
                    );
                } else {
                    console.log(`${id_propiedad} ya estaba guardada.`);
                }
            } catch (error) {
                console.error(
                    `Error procesando ${id_propiedad}: ${error.message}`
                );
            } finally {
                await detailPage.close().catch(() => {});
            }

            await esperar(4000 + Math.random() * 3000);
        }

        // --------------------------------------------------------
        // 4. FINALIZAR Y REENTRENAR
        // --------------------------------------------------------

        console.log(`\nFinalizado. Nuevas propiedades guardadas: ${nuevos}`);

        if (nuevos > 0) {
            try {
                const respuesta = await fetch(`${IA_URL}/reentrenar`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-KEY': process.env.INTERNAL_API_KEY || ''
                    },
                    signal: AbortSignal.timeout(10000)
                });

                if (respuesta.ok) {
                    console.log('Solicitud de reentrenamiento enviada.');
                } else {
                    console.warn(`Reentrenamiento: HTTP ${respuesta.status}`);
                }
            } catch (error) {
                console.warn(`No se pudo reentrenar la IA: ${error.message}`);
            }
        }
    } catch (error) {
        console.error(`Error general en la ejecución: ${error.stack || error.message}`);
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }

        await pool.end().catch(() => {});
    }
})();
