import { CheerioCrawler, Dataset } from 'crawlee';
import fs from 'fs';
import path from 'path';

export const GET = async () => {
    const CARPETA_DATA = path.join(process.cwd(), 'storage', 'datasets', 'default'); 
    const ARCHIVO_FINAL = path.join(process.cwd(), 'dataset_propiedades.json');  

    try {
        console.log("🤖 [Scraper] Iniciando extracción inteligente, bilingüe y dirigida...");
        
        const crawler = new CheerioCrawler({
            maxRequestsPerCrawl: 40, 
            
            preNavigationHooks: [
                async ({ request, gotOptions }) => {
                    if (gotOptions) {
                        gotOptions.headers = {
                            ...gotOptions.headers,
                            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                            'accept-language': 'es-ES,es;q=0.9',
                            'referer': 'https://buenosaires.craigslist.org/',
                        };
                    }
                },
            ],
            
            async requestHandler({ $, request, enqueueLinks, log }) {
                const urlActual = request.url;
                log.info(`🔍 Analizando ruta: ${urlActual}`);
                
                if (urlActual.includes('/search/') || urlActual.endsWith('/apa')) {
                    log.info("📋 Catálogo detectado. Filtrando enlaces de propiedades reales...");
                    
                    await enqueueLinks({
                        selector: '.gallery-card a, .titlestring, a[href*="/apa/d/"]',
                        globs: ['**/apa/d/**/*.html'],
                        baseUrl: request.loadedUrl,
                    });
                    return;
                } 
                if (urlActual.includes('/apa/d/')) {
                    log.info("📌 Ficha de propiedad confirmada. Procesando selectores estructurados...");

                    const idMatch = urlActual.match(/\/(\d+)\.html/);
                    const id_propiedad = idMatch ? idMatch[1] : `cl-${Math.floor(Math.random() * 10000000)}`;

                    // --- EXTRACCIÓN QUIRÚRGICA DEL HEADER DE CRAIGSLIST ---
                    const precioTexto = $('.price').first().text().trim();           // Captura "₱1550"
                    const housingTexto = $('.housing').first().text().trim();         // Captura "3br - 50m²"
                    const tituloTexto = $('#titletextonly').first().text().trim();    // Captura "3 Bedrooms Flat in Recoleta..."
                    
                    // 1. Limpieza del precio
                    let precio_usd = null;
                    if (precioTexto) {
                        precio_usd = parseInt(precioTexto.replace(/\D/g, ''), 10) || null;
                    }
                    
                    // 2. Extraer datos técnicos desde la burbuja .housing (la más confiable)
                    const dormitoriosMatch = housingTexto.match(/(\d+)\s*br/i);
                    const dormitorios = dormitoriosMatch ? parseInt(dormitoriosMatch[1], 10) : null;

                    const banosMatch = housingTexto.match(/(\d+)\s*ba/i);
                    const banos = banosMatch ? parseInt(banosMatch[1], 10) : null;

                    const superficieMatch = housingTexto.match(/(\d+)\s*(?:m²|m2|mts|sqm)/i);
                    let superficie_total_m2 = superficieMatch ? parseInt(superficieMatch[1], 10) : null;

                    // Fallback para superficie por si no figura en .housing pero sí en el cuerpo del título
                    if (!superficie_total_m2 && tituloTexto) {
                        const superficieFallback = tituloTexto.toLowerCase().match(/(\d+)\s*(?:m²|m2|mts|sqm)/i);
                        superficie_total_m2 = superficieFallback ? parseInt(superficieFallback[1], 10) : null;
                    }

                    // 3. Capturar especificaciones adicionales (burbujas inferiores si existieran)
                    const especificacionesInfe = $('.attrgroup .shared-line-bubble').map((i, el) => $(el).text().toLowerCase()).get().join(' | ');

                    // --- ANÁLISIS SOBRE EL CUERPO DE LA PUBLICACIÓN ---
                    const cuerpoTexto = $('#postingbody').text().toLowerCase();

                    // Mapeo bilingüe de Amenities
                    const cochera = cuerpoTexto.includes('cochera') || cuerpoTexto.includes('cocheras') || cuerpoTexto.includes('garage') || cuerpoTexto.includes('estacionamiento') || cuerpoTexto.includes('parking');
                    const balcon = cuerpoTexto.includes('balcon') || cuerpoTexto.includes('balcón') || cuerpoTexto.includes('balcony');
                    const terraza = cuerpoTexto.includes('terraza') || cuerpoTexto.includes('terrace');
                    const patio = cuerpoTexto.includes('patio') || cuerpoTexto.includes('yard');
                    const pileta = cuerpoTexto.includes('pileta') || cuerpoTexto.includes('piscina') || cuerpoTexto.includes('pool') || cuerpoTexto.includes('swimming');
                    const parrilla = cuerpoTexto.includes('parrilla') || cuerpoTexto.includes('bbq') || cuerpoTexto.includes('grill');
                    const seguridad_24hs = cuerpoTexto.includes('seguridad') || cuerpoTexto.includes('vigilancia') || cuerpoTexto.includes('custodia') || cuerpoTexto.includes('security') || cuerpoTexto.includes('doorman');
                    const ascensor = cuerpoTexto.includes('ascensor') || cuerpoTexto.includes('ascensores') || cuerpoTexto.includes('elevador') || cuerpoTexto.includes('elevator') || cuerpoTexto.includes('lift');

                    // Detección de Expensas
                    const expensasMatch = cuerpoTexto.match(/(?:expensas|expenses|fee[s]?)\s?(?:de|ars|usd|\$)?\s?(\d+[\d.,]*)/i);
                    const expensas_ars = expensasMatch ? parseInt(expensasMatch[1].replace(/\D/g, ''), 10) : 0;

                    // Mapeo geográfico del Barrio/Zona
                    let barrio_zona = "Capital Federal";
                    const barriosConocidos = ['palermo', 'recoleta', 'belgrano', 'caballito', 'saavedra', 'san telmo', 'puerto madero', 'almagro', 'villa crespo', 'barrio norte', 'centro'];
                    for (const barrio of barriosConocidos) {
                        if (cuerpoTexto.includes(barrio) || tituloTexto.toLowerCase().includes(barrio)) {
                            barrio_zona = barrio.charAt(0).toUpperCase() + barrio.slice(1);
                            break;
                        }
                    }

                    // Extracción de Piso
                    const pisoMatch = cuerpoTexto.match(/(?:piso|floor)\s*(\d+)/i) || cuerpoTexto.match(/(\d+)\s*(?:°|º|º\spiso|rd|th|st|nd)\s*(?:piso|floor)?/i);
                    const piso = pisoMatch ? parseInt(pisoMatch[1], 10) : null;

                    // Extracción de Orientación
                    let orientacion = null;
                    const orientaciones = {
                        Norte: ['norte', 'north'],
                        Sur: ['sur', 'south'],
                        Este: ['este', 'east'],
                        Oeste: ['oeste', 'west']
                    };
                    for (const [key, values] of Object.entries(orientaciones)) {
                        if (values.some(v => cuerpoTexto.includes(v))) {
                            orientacion = key;
                            break;
                        }
                    }

                    // Extracción de Disposición
                    const disposicion = cuerpoTexto.includes('frente') || cuerpoTexto.includes('front') || cuerpoTexto.includes('street view') ? 'Frente' : (cuerpoTexto.includes('contrafrente') || cuerpoTexto.includes('internal') || cuerpoTexto.includes('back view') ? 'Contrafrente' : null);

                    // Extracción de Antigüedad
                    let anios_de_antiguedad = cuerpoTexto.includes('estrenar') || cuerpoTexto.includes('nuevo') || cuerpoTexto.includes('brand new') ? 0 : null;
                    if (anios_de_antiguedad === null) {
                        const antiguedadMatch = cuerpoTexto.match(/(\d+)\s*(?:años de antigüedad|años de antiguedad|años|years old|years of antiquity)/i) || 
                                                cuerpoTexto.match(/(?:antigüedad|antiguedad|age|built in):\s*(\d+)/i);
                        if (antiguedadMatch) {
                            anios_de_antiguedad = parseInt(antiguedadMatch[1], 10);
                        }
                    }

                    // Extracción de Fecha de Publicación
                    const fecha_publicacion = $('time.timeago').first().attr('datetime') || $('.postinginfo time').first().attr('datetime') || null;

                    // Ensamblamos el objeto final
                    const propiedadData = {
                        id_propiedad: id_propiedad,
                        tipo_propiedad: cuerpoTexto.includes('casa') || cuerpoTexto.includes('house') ? 'Casa' : 'Departamento',
                        barrio_zona: barrio_zona,
                        ambientes: dormitorios ? dormitorios + 1 : null, 
                        dormitorios: dormitorios,
                        banos: banos,
                        superficie_total_m2: superficie_total_m2,
                        superficie_cubierta_m2: superficie_total_m2 ? Math.floor(superficie_total_m2 * 0.9) : null, 
                        estado: anios_de_antiguedad === 0 ? 'Excelente' : 'Usado',
                        anios_de_antiguedad: anios_de_antiguedad,
                        piso: piso,
                        orientacion: orientacion,
                        disposicion: disposicion,
                        cochera: cochera,
                        balcon: balcon,
                        terraza: terraza, 
                        patio: patio,
                        pileta: pileta,
                        parrilla: parrilla,
                        seguridad_24hs: seguridad_24hs,
                        ascensor: ascensor,
                        expensas_ars: expensas_ars,
                        precio_usd: precio_usd,
                        fecha_publicacion: fecha_publicacion
                    };

                    if (propiedadData.precio_usd) {
                        await Dataset.pushData(propiedadData);
                        log.info(`✅ Registro exitoso [ID: ${id_propiedad}] - USD ${precio_usd} - M2: ${superficie_total_m2} - Dormitorios: ${dormitorios}`);
                    }
                }
            },
        });

        await crawler.run(['https://buenosaires.craigslist.org/search/apa']); 
        console.log("✅ [Scraper] Extracción y segmentación finalizada.");

        // --- UNIFICADOR DE DATASETS ---
        console.log("📊 [Unificador] Consolidando registros en un único JSON...");
        let totalPropiedades = 0;

        if (fs.existsSync(CARPETA_DATA)) {
            const archivos = fs.readdirSync(CARPETA_DATA);
            
            const datasetCompleto = archivos
                .filter(archivo => archivo.endsWith('.json'))
                .map(archivo => {
                    const contenido = fs.readFileSync(path.join(CARPETA_DATA, archivo), 'utf-8');
                    return JSON.parse(contenido);
                });

            fs.writeFileSync(ARCHIVO_FINAL, JSON.stringify(datasetCompleto, null, 2));
            totalPropiedades = datasetCompleto.length;
        }

        return new Response(JSON.stringify({
            success: true,
            mensaje: "¡Scraping estructurado bilingüe completado con éxito!",
            propiedades_totales: totalPropiedades,
            ruta_archivo: ARCHIVO_FINAL
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        console.error("❌ Error crítico en ejecución:", error);
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}