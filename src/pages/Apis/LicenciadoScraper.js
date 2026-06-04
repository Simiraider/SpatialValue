import { CheerioCrawler, Dataset } from 'crawlee';
import fs from 'fs';
import path from 'path';

export const GET = async () => {
    const CARPETA_DATA = path.join(process.cwd(), 'storage', 'datasets', 'default'); 
    const ARCHIVO_FINAL = path.join(process.cwd(), 'dataset_propiedades.json');  

    try {
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
                
                if (urlActual.includes('/search/') || urlActual.endsWith('/apa')) {
                    await enqueueLinks({
                        selector: '.gallery-card a, .titlestring, a[href*="/apa/d/"]',
                        globs: ['**/apa/d/**/*.html'],
                        baseUrl: request.loadedUrl,
                    });
                    return;
                } 
                
                if (urlActual.includes('/apa/d/')) {
                    const idMatch = urlActual.match(/\/(\d+)\.html/);
                    const id_propiedad = idMatch ? idMatch[1] : `cl-${Math.floor(Math.random() * 10000000)}`;

                    const precioTexto = $('.price').first().text().trim();          
                    const housingTexto = $('.housing').first().text().trim();         
                    const tituloTexto = $('#titletextonly').first().text().trim();   
                    
                    let precio_usd = null;
                    if (precioTexto) {
                        precio_usd = parseInt(precioTexto.replace(/\D/g, ''), 10) || null;
                    }
                    
                    const dormitoriosMatch = housingTexto.match(/(\d+)\s*br/i);
                    const dormitorios = dormitoriosMatch ? parseInt(dormitoriosMatch[1], 10) : null;

                    const banosMatch = housingTexto.match(/(\d+)\s*ba/i);
                    const banos = banosMatch ? parseInt(banosMatch[1], 10) : null;

                    const superficieMatch = housingTexto.match(/(\d+)\s*(?:m²|m2|mts|sqm)/i);
                    let superficie_total_m2 = superficieMatch ? parseInt(superficieMatch[1], 10) : null;

                    if (!superficie_total_m2 && tituloTexto) {
                        const superficieFallback = tituloTexto.toLowerCase().match(/(\d+)\s*(?:m²|m2|mts|sqm)/i);
                        superficie_total_m2 = superficieFallback ? parseInt(superficieFallback[1], 10) : null;
                    }

                    const cuerpoTexto = $('#postingbody').text().toLowerCase();

                    const cochera = cuerpoTexto.includes('cochera') || cuerpoTexto.includes('cocheras') || cuerpoTexto.includes('garage') || cuerpoTexto.includes('estacionamiento') || cuerpoTexto.includes('parking');
                    const balcon = cuerpoTexto.includes('balcon') || cuerpoTexto.includes('balcón') || cuerpoTexto.includes('balcony');
                    const terraza = cuerpoTexto.includes('terraza') || cuerpoTexto.includes('terrace');
                    const patio = cuerpoTexto.includes('patio') || cuerpoTexto.includes('yard');
                    const pileta = cuerpoTexto.includes('pileta') || cuerpoTexto.includes('piscina') || cuerpoTexto.includes('pool') || cuerpoTexto.includes('swimming');
                    const parrilla = cuerpoTexto.includes('parrilla') || cuerpoTexto.includes('bbq') || cuerpoTexto.includes('grill');
                    const seguridad_24hs = cuerpoTexto.includes('seguridad') || cuerpoTexto.includes('vigilancia') || cuerpoTexto.includes('custodia') || cuerpoTexto.includes('security') || cuerpoTexto.includes('doorman');
                    const ascensor = cuerpoTexto.includes('ascensor') || cuerpoTexto.includes('ascensores') || cuerpoTexto.includes('elevador') || cuerpoTexto.includes('elevator') || cuerpoTexto.includes('lift');

                    const expensasMatch = cuerpoTexto.match(/(?:expensas|expenses|fee[s]?)\s?(?:de|ars|usd|\$)?\s?(\d+[\d.,]*)/i);
                    const expensas_ars = expensasMatch ? parseInt(expensasMatch[1].replace(/\D/g, ''), 10) : 0;

                    let barrio_zona = "Capital Federal";
                    const barriosConocidos = ['palermo', 'recoleta', 'belgrano', 'caballito', 'saavedra', 'san telmo', 'puerto madero', 'almagro', 'villa crespo', 'barrio norte', 'centro'];
                    for (const barrio of barriosConocidos) {
                        if (cuerpoTexto.includes(barrio) || tituloTexto.toLowerCase().includes(barrio)) {
                            barrio_zona = barrio.charAt(0).toUpperCase() + barrio.slice(1);
                            break;
                        }
                    }

                    const pisoMatch = cuerpoTexto.match(/(?:piso|floor)\s*(\d+)/i) || cuerpoTexto.match(/(\d+)\s*(?:°|º|º\spiso|rd|th|st|nd)\s*(?:piso|floor)?/i);
                    const piso = pisoMatch ? parseInt(pisoMatch[1], 10) : null;

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

                    const disposicion = cuerpoTexto.includes('frente') || cuerpoTexto.includes('front') || cuerpoTexto.includes('street view') ? 'Frente' : (cuerpoTexto.includes('contrafrente') || cuerpoTexto.includes('internal') || cuerpoTexto.includes('back view') ? 'Contrafrente' : null);

                    let anios_de_antiguedad = cuerpoTexto.includes('estrenar') || cuerpoTexto.includes('nuevo') || cuerpoTexto.includes('brand new') ? 0 : null;
                    if (anios_de_antiguedad === null) {
                        const antiguedadMatch = cuerpoTexto.match(/(\d+)\s*(?:años de antigüedad|años de antiguedad|años|years old|years of antiquity)/i) || 
                                                cuerpoTexto.match(/(?:antigüedad|antiguedad|age|built in):\s*(\d+)/i);
                        if (antiguedadMatch) {
                            anios_de_antiguedad = parseInt(antiguedadMatch[1], 10);
                        }
                    }

                    const fecha_publicacion = $('time.timeago').first().attr('datetime') || $('.postinginfo time').first().attr('datetime') || null;

                    const propiedadData = {
                        tipo_propiedad: cuerpoTexto.includes('casa') || cuerpoTexto.includes('house') ? 'Casa' : 'Departamento',
                        barrio_zona: barrio_zona,
                        ambientes: dormitorios ? dormitorios + 1 : 1, 
                        dormitorios: dormitorios || 1,
                        banos: banos || 1,
                        superficie_total_m2: superficie_total_m2 || 45,
                        superficie_cubierta_m2: superficie_total_m2 ? Math.floor(superficie_total_m2 * 0.9) : 40, 
                        estado: anios_de_antiguedad === 0 ? 'Excelente' : 'Usado',
                        anios_de_antiguedad: anios_de_antiguedad || 10,
                        cochera: cochera,
                        balcon: balcon,
                        terraza: terrazo || terraza, 
                        patio: patio,
                        pileta: pileta,
                        parrilla: parrilla,
                        seguridad_24hs: seguridad_24hs,
                        ascensor: ascensor,
                        expensas_ars: expensas_ars
                    };

                    if (precio_usd) {
                        try {
                            const respuestaIA = await fetch('http://127.0.0.1:8000/estimar-precio', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(propiedadData)
                            });

                            if (respuestaIA.ok) {
                                const resultado = await respuestaIA.json();
                                
                                const registroFinal = {
                                    id_propiedad,
                                    ...propiedadData,
                                    piso,
                                    orientacion,
                                    disposicion,
                                    precio_real_usd: precio_usd,
                                    precio_estimado_ia_usd: resultado.precio_estimado_usd,
                                    coordenadas_gps: resultado.coordenadas,
                                    fecha_publicacion
                                };

                                await Dataset.pushData(registroFinal);
                            } else {
                                await Dataset.pushData({ id_propiedad, ...propiedadData, precio_real_usd: precio_usd, fecha_publicacion });
                            }
                        } catch (err) {
                            await Dataset.pushData({ id_propiedad, ...propiedadData, precio_real_usd: precio_usd, fecha_publicacion });
                        }
                    }
                }
            },
        });

        await crawler.run(['https://buenosaires.craigslist.org/search/apa']); 

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
            propiedades_totales: totalPropiedades,
            ruta_archivo: ARCHIVO_FINAL
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}