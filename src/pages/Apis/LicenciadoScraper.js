import { PlaywrightCrawler, Dataset } from 'crawlee';
import fs from 'fs';
import path from 'path';

export const GET = async () => {
    const CARPETA_DATA = path.join(process.cwd(), 'storage', 'datasets', 'default'); 
    const ARCHIVO_FINAL = path.join(process.cwd(), 'dataset_propiedades.json');  

    try {
        const crawler = new PlaywrightCrawler({
            maxConcurrency: 1, 
            maxRequestsPerCrawl: 2000, 
            headless: false, 
            browserPoolOptions: {
                useFingerprints: true,
            },
            
            async requestHandler({ page, request, enqueueLinks, parseWithCheerio }) {
                const urlActual = request.url;
                
                if (urlActual.includes('-alquiler-') || urlActual.includes('-venta-') || (urlActual.includes('.html') && !urlActual.includes('/propiedades/'))) {
                    
                    try {
                        await page.waitForSelector('[class*="PostingCard"], [data-qa="posting-card"]', { timeout: 30000 });
                    } catch (e) {
                        console.log("⚠️ No se detectaron propiedades. Si ves un Cloudflare/Captcha en la pantalla, resuélvelo manualmente ahora.");
                        await page.waitForSelector('[class*="PostingCard"], [data-qa="posting-card"]', { timeout: 60000 });
                    }

                    await enqueueLinks({
                        selector: 'a[href*="/propiedades/"]',
                        globs: ['**/propiedades/**/*.html'],
                        baseUrl: 'https://www.zonaprop.com.ar',
                    });
                    return;
                } 
                
                if (urlActual.includes('/propiedades/')) {
                    try {
                        await page.waitForSelector('[class*="PriceValue"], [class*="DescriptionBlock"]', { timeout: 15000 });
                    } catch (e) {}

                    const $ = await parseWithCheerio();
                    
                    const idMatch = urlActual.match(/-(\d+)\.html/);
                    const id_propiedad = idMatch ? `zp-${idMatch[1]}` : `zp-${Math.floor(Math.random() * 10000000)}`;

                    const precioTexto = $('[class*="PriceValue"]').first().text().trim() || $('[class*="price"]').first().text().trim();
                    const expensasTexto = $('[class*="ExpensesValue"]').first().text().trim() || $('[class*="expensas"]').first().text().trim();
                    const tituloTexto = $('[class*="Title"]').first().text().trim();
                    const cuerpoTexto = $('[class*="DescriptionBlock"]').text().toLowerCase();
                    
                    let precio_usd = null;
                    if (precioTexto.includes('USD')) {
                        precio_usd = parseInt(precioTexto.replace(/\D/g, ''), 10) || null;
                    } else if (precioTexto.includes('$')) {
                        return; 
                    }

                    let expensas_ars = 0;
                    if (expensasTexto) {
                        expensas_ars = parseInt(expensasTexto.replace(/\D/g, ''), 10) || 0;
                    }

                    let superficie_total_m2 = null;
                    let dormitorios = null;
                    let banos = null;

                    $('[class*="IconFeatures"]').each((_, el) => {
                        const textoFeature = $(el).text().toLowerCase();
                        if (textoFeature.includes('tot') || textoFeature.includes('m²')) {
                            superficie_total_m2 = parseInt(textoFeature.replace(/\D/g, ''), 10) || null;
                        }
                        if (textoFeature.includes('dorm') || textoFeature.includes('hab')) {
                            dormitorios = parseInt(textoFeature.replace(/\D/g, ''), 10) || null;
                        }
                        if (textoFeature.includes('baño')) {
                            banos = parseInt(textoFeature.replace(/\D/g, ''), 10) || null;
                        }
                    });

                    const cochera = cuerpoTexto.includes('cochera') || cuerpoTexto.includes('garage') || cuerpoTexto.includes('estacionamiento');
                    const balcon = cuerpoTexto.includes('balcon') || cuerpoTexto.includes('balcón');
                    const terraza = cuerpoTexto.includes('terraza');
                    const patio = cuerpoTexto.includes('patio');
                    const pileta = cuerpoTexto.includes('pileta') || cuerpoTexto.includes('piscina');
                    const parrilla = cuerpoTexto.includes('parrilla');
                    const seguridad_24hs = cuerpoTexto.includes('seguridad') || cuerpoTexto.includes('vigilancia');
                    const ascensor = cuerpoTexto.includes('ascensor') || cuerpoTexto.includes('elevador');
                    const baulera = cuerpoTexto.includes('baulera');
                    const sum = cuerpoTexto.includes('sum') || cuerpoTexto.includes('usos múltiples');
                    const camara = cuerpoTexto.includes('camara') || cuerpoTexto.includes('cámara') || cuerpoTexto.includes('cctv');
                    const gym = cuerpoTexto.includes('gym') || cuerpoTexto.includes('gimnasio');
                    const lounge = cuerpoTexto.includes('lounge');
                    const laundry = cuerpoTexto.includes('laundry') || cuerpoTexto.includes('lavadero');

                    let barrio_zona = "Capital Federal";
                    const barriosConocidos = ['palermo', 'recoleta', 'belgrano', 'caballito', 'saavedra', 'san telmo', 'puerto madero', 'almagro', 'villa crespo'];
                    for (const barrio of barriosConocidos) {
                        if (cuerpoTexto.includes(barrio) || tituloTexto.toLowerCase().includes(barrio)) {
                            barrio_zona = barrio.charAt(0).toUpperCase() + barrio.slice(1);
                            break;
                        }
                    }

                    const pisoMatch = cuerpoTexto.match(/(?:piso|floor)\s*(\d+)/i);
                    const piso = pisoMatch ? parseInt(pisoMatch[1], 10) : 1;

                    const propiedadData = {
                        tipo_propiedad: cuerpoTexto.includes('casa') ? 'Casa' : 'Departamento',
                        barrio_zona: barrio_zona,
                        ambientes: dormitorios ? dormitorios + 1 : 1, 
                        dormitorios: dormitorios || 1,
                        banos: banos || 1,
                        superficie_total_m2: superficie_total_m2 || 45,
                        superficie_cubierta_m2: superficie_total_m2 ? Math.floor(superficie_total_m2 * 0.9) : 40, 
                        estado: cuerpoTexto.includes('estrenar') || cuerpoTexto.includes('nuevo') ? 'Excelente' : 'Usado',
                        anios_de_antiguedad: cuerpoTexto.includes('estrenar') ? 0 : 10,
                        piso: piso,
                        orientacion: "No especificada",
                        disposicion: cuerpoTexto.includes('frente') ? 'Frente' : (cuerpoTexto.includes('contrafrente') ? 'Contrafrente' : 'No especificada'),
                        cochera: cochera,
                        balcon: balcon,
                        terraza: terraza, 
                        patio: patio,
                        pileta: pileta,
                        parrilla: parrilla,
                        seguridad_24hs: seguridad_24hs,
                        ascensor: ascensor,
                        expensas_ars: expensas_ars,
                        baulera: baulera,
                        sum: sum,
                        seguridad_tipo: seguridad_24hs ? 'Física' : 'Ninguno',
                        camara: camara,
                        gym: gym,
                        lounge: lounge,
                        laundry: laundry
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
                                await Dataset.pushData({
                                    id_propiedad,
                                    ...propiedadData,
                                    precio_real_usd: precio_usd,
                                    precio_estimado_ia_usd: resultado.precio_estimado_usd,
                                    coordenadas_gps: resultado.coordenadas,
                                    fecha_publicacion: new Date().toISOString().split('T')[0]
                                });
                            } else {
                                await Dataset.pushData({ id_propiedad, ...propiedadData, precio_real_usd: precio_usd, fecha_publicacion: null });
                            }
                        } catch (err) {
                            await Dataset.pushData({ id_propiedad, ...propiedadData, precio_real_usd: precio_usd, fecha_publicacion: null });
                        }
                    }
                }
            },
        });

        await crawler.run(['https://www.zonaprop.com.ar/departamentos-alquiler-capital-federal.html']); 

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