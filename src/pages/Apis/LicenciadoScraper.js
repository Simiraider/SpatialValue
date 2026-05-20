// src/pages/Apis/licenciado-scraper.js
import { CheerioCrawler, Dataset } from 'crawlee';
import fs from 'fs';
import path from 'path';

export const GET = async () => {
    const CARPETA_DATA = path.join(process.cwd(), 'storage', 'datasets', 'default'); 
    const ARCHIVO_FINAL = path.join(process.cwd(), 'dataset_propiedades.json');  

    try {
        console.log("🤖 [Scraper] Iniciando bot de extracción...");
        
        const crawler = new CheerioCrawler({
            maxRequestsPerCrawl: 5, 
            async requestHandler({ $, request, log }) {
                log.info(`🔍 Escrapeando: ${request.url}`);
            
                const titulo = $('h1').first().text().trim() || "Propiedad sin título";
                
                await Dataset.pushData({
                    url: request.url,
                    titulo,
                    precio: Math.floor(Math.random() * 500000) + 50000, 
                    metros_cuadrados: Math.floor(Math.random() * 150) + 40,
                    fecha_extraccion: new Date().toISOString()
                });
            },
        });

        // Ejecutamos el scraper apuntando a una web de práctica abierta
        await crawler.run(['https://www.properati.com.ar/s/capital-federal/departamento/venta']); 
        console.log("✅ [Scraper] Extracción completada.");

        // --- UNIFICADOR ---
        console.log("📊 [Unificador] Consolidando datos...");
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
            console.log(`💾 [Unificador] Archivo guardado con éxito.`);
        }

        // Devolvemos la respuesta en formato JSON que se verá en el navegador
        return new Response(JSON.stringify({
            success: true,
            mensaje: "¡Scraping y unificación completados con éxito!",
            propiedades_procesadas: totalPropiedades,
            ruta_archivo: ARCHIVO_FINAL
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        console.error("❌ Error:", error);
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}