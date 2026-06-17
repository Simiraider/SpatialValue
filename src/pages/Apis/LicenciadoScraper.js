import { PlaywrightCrawler } from 'crawlee';
import fs from 'fs';
import path from 'path';

const ARCHIVO_FINAL = path.join(process.cwd(), 'dataset_propiedades.json');
const getProcessedIds = () => {
    if (!fs.existsSync(ARCHIVO_FINAL)) return new Set();
    try {
        return new Set(JSON.parse(fs.readFileSync(ARCHIVO_FINAL, 'utf-8')).map((p) => p.id_propiedad));
    } catch (e) { return new Set(); }
};

export const GET = async () => {
    const idsProcesados = getProcessedIds(), nuevosResultados = [];

    const crawler = new PlaywrightCrawler({
        maxConcurrency: 1, 
        headless: false, 
        // 👇 AGREGA ESTE BLOQUE PARA USAR TU CHROME REAL
        launchContext: {
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Ruta en Windows
            // Si estás en Mac usa: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        },
        browserPoolOptions: { 
            useFingerprints: true 
        },
        async requestHandler({ page, request, enqueueLinks, parseWithCheerio }) {
            const urlActual = request.url;

            if (urlActual.includes('-alquiler-') || urlActual.includes('-venta-') || (urlActual.includes('.html') && !urlActual.includes('/propiedades/'))) {
                try { 
                    await page.waitForSelector('[class*="PostingCard"], [data-qa="posting-card"]', { timeout: 30000 }); 
                } catch (e) { // <-- Corregido con (e)
                    console.log('⚠️ Captcha detectado. Resolvelo manualmente.'); 
                    await page.waitForSelector('[class*="PostingCard"]', { timeout: 240000 }); 
                }
                
                await page.waitForTimeout(2000 + Math.random() * 2000);
                await enqueueLinks({ selector: 'a[href*="/propiedades/"]', globs: ['**/propiedades/**/*.html'], baseUrl: 'https://www.zonaprop.com.ar' });
                return;
            }

            if (urlActual.includes('/propiedades/')) {
                const idMatch = urlActual.match(/-(\d+)\.html/);
                const id_propiedad = idMatch ? `zp-${idMatch[1]}` : `zp-${Math.floor(Math.random() * 10000000)}`;
                if (idsProcesados.has(id_propiedad)) return console.log(`⏩ Saltando duplicado: ${id_propiedad}`);

                try { 
                    await page.waitForSelector('[class*="PriceValue"], [class*="DescriptionBlock"]', { timeout: 15000 }); 
                } catch (e) {} // <-- Corregido con (e)
                
                const $ = await parseWithCheerio();

                const precioTexto = $('[class*="PriceValue"]').first().text().trim() || $('[class*="price"]').first().text().trim();
                if (!precioTexto.includes('USD')) return; 

                const expensasTexto = $('[class*="ExpensesValue"]').first().text().trim() || $('[class*="expensas"]').first().text().trim();
                const tituloTexto = $('[class*="Title"]').first().text().trim();
                const cuerpoTexto = $('[class*="DescriptionBlock"]').text().toLowerCase();

                let superficie_total_m2 = null, dormitorios = null, banos = null;
                $('[class*="IconFeatures"]').each((_, el) => {
                    const txt = $(el).text().toLowerCase();
                    const num = parseInt(txt.replace(/\D/g, ''), 10) || null;
                    if (txt.includes('tot') || txt.includes('m²')) superficie_total_m2 = num;
                    if (txt.includes('dorm') || txt.includes('hab')) dormitorios = num;
                    if (txt.includes('baño')) banos = num;
                });

                const check = (...words) => words.some(w => cuerpoTexto.includes(w));
                const barrios = ['palermo', 'recoleta', 'belgrano', 'caballito', 'saavedra', 'san telmo', 'puerto madero', 'almagro', 'villa crespo'];
                const barrioEncontrado = barrios.find(b => cuerpoTexto.includes(b) || tituloTexto.toLowerCase().includes(b));

                const propiedadData = {
                    tipo_propiedad: cuerpoTexto.includes('casa') ? 'Casa' : 'Departamento',
                    barrio_zona: barrioEncontrado ? barrioEncontrado.charAt(0).toUpperCase() + barrioEncontrado.slice(1) : "Capital Federal",
                    ambientes: dormitorios ? dormitorios + 1 : 1, dormitorios: dormitorios || 1, banos: banos || 1,
                    superficie_total_m2: superficie_total_m2 || 45, superficie_cubierta_m2: superficie_total_m2 ? Math.floor(superficie_total_m2 * 0.9) : 40,
                    estado: check('estrenar', 'nuevo') ? 'Excellent' : 'Usado', anios_de_antiguedad: check('estrenar') ? 0 : 10,
                    piso: parseInt(cuerpoTexto.match(/(?:piso|floor)\s*(\d+)/i)?.[1] || '1', 10), orientacion: "No especificada",
                    disposicion: cuerpoTexto.includes('frente') ? 'Frente' : (cuerpoTexto.includes('contrafrente') ? 'Contrafrente' : 'No especificada'),
                    cochera: check('cochera', 'garage', 'estacionamiento'), balcon: check('balcon', 'balcón'), terraza: check('terraza'),
                    patio: check('patio'), pileta: check('pileta', 'piscina'), parrilla: check('parrilla'), seguridad_24hs: check('seguridad', 'vigilancia'),
                    ascensor: check('ascensor', 'elevador'), expensas_ars: parseInt(expensasTexto.replace(/\D/g, ''), 10) || 0,
                    baulera: check('baulera'), sum: check('sum', 'usos múltiples'), seguridad_tipo: check('seguridad', 'vigilancia') ? 'Física' : 'Ninguno',
                    camara: check('camara', 'cámara', 'cctv'), gym: check('gym', 'gimnasio'), lounge: check('lounge'), laundry: check('laundry', 'lavadero')
                };

                try {
                    const resIA = await fetch('http://127.0.0.1:8000/estimar-precio', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(propiedadData)
                    });
                    const resultado = resIA.ok ? await resIA.json() : {};
                    nuevosResultados.push({
                        id_propiedad, ...propiedadData, precio_real_usd: parseInt(precioTexto.replace(/\D/g, ''), 10),
                        precio_estimado_ia_usd: resultado.precio_estimado_usd || null, coordenadas_gps: resultado.coordenadas || null,
                        fecha_publicacion: new Date().toISOString().split('T')[0]
                    });
                    idsProcesados.add(id_propiedad);
                } catch (err) { // <-- Corregido con (err)
                    nuevosResultados.push({ id_propiedad, ...propiedadData, precio_real_usd: parseInt(precioTexto.replace(/\D/g, ''), 10), fecha_publicacion: null });
                }
            }
        },
    });

    await crawler.run(['https://www.zonaprop.com.ar/departamentos-alquiler-capital-federal.html']);

    const dataExistente = fs.existsSync(ARCHIVO_FINAL) ? JSON.parse(fs.readFileSync(ARCHIVO_FINAL, 'utf-8')) : [];
    fs.writeFileSync(ARCHIVO_FINAL, JSON.stringify([...dataExistente, ...nuevosResultados], null, 2));

    return new Response(JSON.stringify({ success: true, propiedades_totales: dataExistente.length + nuevosResultados.length }), { status: 200 });
};