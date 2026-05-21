// src/pages/Apis/LicenciadoScraper.js
import { CheerioCrawler, Dataset } from 'crawlee';
import fs from 'fs';
import path from 'path';

export const GET = async () => {
    const CARPETA_DATA = path.join(process.cwd(), 'storage', 'datasets', 'default'); 
    const ARCHIVO_FINAL = path.join(process.cwd(), 'dataset_propiedades.json');  

    try {
        console.log("🤖 [Scraper] Iniciando extracción inteligente y dirigida...");
        
        const crawler = new CheerioCrawler({
            maxRequestsPerCrawl: 40, // Ampliado para cubrir suficientes muestras limpias
            
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
                
                // 🛑 CASO 1: Es la página de listados/catálogo.
                // Filtramos estrictamente para SOLO seguir links que apunten a publicaciones individuales de propiedades (.html)
                if (urlActual.includes('/search/') || urlActual.endsWith('/apa')) {
                    log.info("📋 Catálogo detectado. Filtrando enlaces de propiedades reales...");
                    
                    await enqueueLinks({
                        selector: '.gallery-card a, .titlestring, a[href*="/apa/d/"]',
                        globs: ['**/apa/d/**/*.html'], // 🎯 FILTRO CRÍTICO: Solo entra a URLs con formato de anuncio individual
                        baseUrl: request.loadedUrl,
                    });
                    return;
                } 
                
                // 🏠 CASO 2: Procesar la ficha de una Propiedad Real
                if (urlActual.includes('/apa/d/')) {
                    log.info("📌 Ficha de propiedad confirmada. Procesando selectores estructurados...");

                    // 1. Extraer ID Único desde la URL o el footer
                    const idMatch = urlActual.match(/\/(\d+)\.html/);
                    const id_propiedad = idMatch ? idMatch[1] : `cl-${Math.floor(Math.random() * 10000000)}`;

                    // 2. Título principal
                    const tituloCompleto = $('#titletextonly').text().trim() || $('title').text().trim();

                    // 3. Extracción y normalización de Precio
                    const precioTexto = $('.price').first().text().trim();
                    let precio_usd = null;
                    if (precioTexto) {
                        // Limpia símbolos y convierte a entero (ej: "₱1590" o "$1200" -> 1590)
                        precio_usd = parseInt(precioTexto.replace(/\D/g, ''), 10) || null;
                    }

                    // 4. Mapear Atributos Nativos del bloque ".shared-line-bubble" de Craigslist
                    // Suelen venir en formatos como: "3BR / 1Ba", "57m2", "available aug 1"
                    const especificaciones = $('.attrgroup .shared-line-bubble').map((i, el) => $(el).text().toLowerCase()).get().join(' | ');

                    // Extracción de dormitorios (BR)
                    const dormitoriosMatch = especificaciones.match(/(\d+)\s?br/);
                    const dormitorios = dormitoriosMatch ? parseInt(dormitoriosMatch[1], 10) : null;

                    // Extracción de baños (Ba)
                    const banosMatch = especificaciones.match(/(\d+)\s?ba/);
                    const banos = banosMatch ? parseInt(banosMatch[1], 10) : null;

                    // Extracción de superficie en m²
                    const superficieMatch = especificaciones.match(/(\d+)\s?m²/);
                    const superficie_total_m2 = superficieMatch ? parseInt(superficieMatch[1], 10) : null;

                    // 5. Análisis e inferencia inteligente sobre el Cuerpo de la Publicación (#postingbody)
                    const cuerpoTexto = $('#postingbody').text().toLowerCase();

                    // Mapeo inteligente de booleanos basados en palabras clave presentes en el texto descriptivo
                    const cochera = cuerpoTexto.includes('cochera') || cuerpoTexto.includes('cocheras') || cuerpoTexto.includes('garage') || cuerpoTexto.includes('estacionamiento');
                    const balcon = cuerpoTexto.includes('balcon') || cuerpoTexto.includes('balcón');
                    const terraza = cuerpoTexto.includes('terraza');
                    const patio = cuerpoTexto.includes('patio');
                    const pileta = cuerpoTexto.includes('pileta') || cuerpoTexto.includes('piscina');
                    const parrilla = cuerpoTexto.includes('parrilla');
                    const seguridad_24hs = cuerpoTexto.includes('seguridad') || cuerpoTexto.includes('vigilancia') || cuerpoTexto.includes('custodia');
                    const ascensor = cuerpoTexto.includes('ascensor') || cuerpoTexto.includes('ascensores') || cuerpoTexto.includes('elevador');

                    // Intentar pescar expensas si se mencionan explícitamente en Pesos
                    const expensasMatch = cuerpoTexto.match(/expensas\s?(?:de|ars||\$)?\s?(\d+[\d.,]*)/);
                    const expensas_ars = expensasMatch ? parseInt(expensasMatch[1].replace(/\D/g, ''), 10) : 0;

                    // Mapeo geográfico del Barrio/Zona
                    let barrio_zona = "Capital Federal";
                    const barriosConocidos = ['palermo', 'recoleta', 'belgrano', 'caballito', 'saavedra', 'san telmo', 'puerto madero', 'almagro', 'villa crespo', 'barrio norte', 'centro'];
                    for (const barrio of barriosConocidos) {
                        if (cuerpoTexto.includes(barrio) || tituloCompleto.toLowerCase().includes(barrio)) {
                            barrio_zona = barrio.charAt(0).toUpperCase() + barrio.slice(1);
                            break;
                        }
                    }

                    // 6. Ensamblamos el objeto final respetando estrictamente tus 23 columnas requeridas
                    const propiedadData = {
                        id_propiedad: id_propiedad,
                        tipo_propiedad: cuerpoTexto.includes('casa') ? 'Casa' : 'Departamento',
                        barrio_zona: barrio_zona,
                        ambientes: dormitorios ? dormitorios + 1 : null, // Métrica estándar: ambientes = dormitorios + living
                        dormitorios: dormitorios,
                        banos: banos,
                        superficie_total_m2: superficie_total_m2,
                        superficie_cubierta_m2: superficie_total_m2 ? Math.floor(superficie_total_m2 * 0.9) : null, // Cubierto estimado
                        estado: cuerpoTexto.includes('nuevo') || cuerpoTexto.includes('estrenar') ? 'Excelente' : 'Usado',
                        anios_de_antiguedad: cuerpoTexto.includes('estrenar') ? 0 : null,
                        piso: cuerpoTexto.match(/piso\s?(\d+)/) ? parseInt(cuerpoTexto.match(/piso\s?(\d+)/)[1], 10) : null,
                        orientacion: null, 
                        disposicion: cuerpoTexto.includes('frente') ? 'Frente' : (cuerpoTexto.includes('contrafrente') ? 'Contrafrente' : null),
                        cochera: cochera,
                        balcon: balcon,
                        terraza: terraza,
                        patio: patio,
                        pileta: pileta,
                        parrilla: parrilla,
                        seguridad_24hs: seguridad_24hs,
                        ascensor: ascensor,
                        expensas_ars: expensas_ars,
                        precio_usd: precio_usd
                    };

                    // Guardamos solo si tiene un precio válido para que no te ensucie las métricas de la IA
                    if (propiedadData.precio_usd) {
                        await Dataset.pushData(propiedadData);
                        log.info(`✅ Registro exitoso [ID: ${id_propiedad}] - USD ${precio_usd} en ${barrio_zona}`);
                    }
                }
            },
        });

        // Ejecutamos apuntando a la sección principal de alquileres/ventas de propiedades
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
            mensaje: "¡Scraping estructurado completado con éxito!",
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