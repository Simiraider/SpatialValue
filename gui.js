// gui.js
import http from 'http';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
let scraperProcess = null;
let sseClients = [];

// Transmitir logs a la interfaz web por Server-Sent Events (SSE)
function broadcastLog(data) {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
        if (!line.trim()) return;
        sseClients.forEach(res => {
            res.write(`data: ${JSON.stringify(line)}\n\n`);
        });
    });
}

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Panel Scraper Inmobiliario</title>
    <style>
        body { font-family: monospace; background: #121212; color: #e0e0e0; margin: 20px; }
        h1 { border-bottom: 1px solid #444; padding-bottom: 5px; font-size: 1.4rem; color: #fff; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px; }
        label { display: block; font-weight: bold; margin-bottom: 3px; font-size: 0.9rem; }
        input[type="text"], input[type="number"], select {
            width: 100%; box-sizing: border-box; background: #222; color: #fff; border: 1px solid #555;
            padding: 6px; font-family: monospace; font-size: 0.9rem;
        }
        .checkbox-group { margin-top: 10px; display: flex; gap: 20px; }
        .checkbox-group label { font-weight: normal; cursor: pointer; }
        button {
            padding: 10px 20px; font-weight: bold; font-family: monospace; cursor: pointer; border: none; font-size: 1rem;
        }
        .btn-start { background: #2e7d32; color: white; margin-right: 10px; }
        .btn-stop { background: #c62828; color: white; }
        button:disabled { opacity: 0.4; cursor: not-allowed; }
        #status { font-weight: bold; margin-left: 15px; }
        pre#logs {
            background: #000; color: #00ff00; border: 1px solid #333; padding: 10px;
            height: 350px; overflow-y: auto; white-space: pre-wrap; font-size: 0.85rem; margin-top: 15px;
        }
        .url-preview { background: #1e1e1e; padding: 8px; border: 1px dashed #555; color: #aaa; margin-top: 10px; font-size: 0.85rem; word-break: break-all; }
    </style>
</head>
<body>

    <h1>[ Configuración del Scraper ]</h1>

    <form id="scraperForm">
        <div class="grid">
            <div>
                <label>Tipo de Propiedad:</label>
                <select id="tipoPropiedad" name="tipoPropiedad" onchange="updateUrlPreview()">
                    <option value="casas">Casas</option>
                    <option value="departamentos">Departamentos</option>
                    <option value="ph">PH</option>
                    <option value="terrenos">Terrenos</option>
                    <option value="locales-comerciales">Locales Comerciales</option>
                    <option value="oficinas">Oficinas</option>
                </select>
            </div>
            <div>
                <label>Operación:</label>
                <select id="operacion" name="operacion" onchange="updateUrlPreview()">
                    <option value="venta">Venta</option>
                    <option value="alquiler">Alquiler</option>
                </select>
            </div>
            <div>
                <label>Barrio / Zona:</label>
                <select id="barrioSelect" name="barrioSelect" onchange="toggleCustomBarrio(); updateUrlPreview();">
                    <option value="capital-federal">Capital Federal (Todos)</option>
                    <option value="palermo">Palermo</option>
                    <option value="belgrano">Belgrano</option>
                    <option value="caballito">Caballito</option>
                    <option value="recoleta">Recoleta</option>
                    <option value="almagro">Almagro</option>
                    <option value="villa-urquiza">Villa Urquiza</option>
                    <option value="custom">-- Escribir otro barrio --</option>
                </select>
                <input type="text" id="barrioCustom" placeholder="Ej: devoto o villa-devoto" style="display:none; margin-top:5px;" oninput="updateUrlPreview()">
            </div>
            <div>
                <label>Puerto CDP de Chrome:</label>
                <input type="text" id="cdpUrl" value="http://127.0.0.1:9222">
            </div>
            <div>
                <label>Páginas máximas del listado:</label>
                <input type="number" id="paginasMax" value="5" min="1" max="100">
            </div>
            <div>
                <label>Límite máximo de propiedades (0 = sin límite):</label>
                <input type="number" id="maxPropiedades" value="0" min="0">
            </div>
        </div>

        <div class="checkbox-group">
            <label><input type="checkbox" id="usarFichaprop" checked> Consultar Fichaprop.ar</label>
            <label><input type="checkbox" id="dryRun"> Modo Prueba (DRY_RUN - No guardar en DB)</label>
        </div>

        <div style="margin-top: 15px;">
            <label>URL de prueba específica (Opcional, procesa solo 1 publicación):</label>
            <input type="text" id="urlPrueba" placeholder="https://www.zonaprop.com.ar/propiedades/...">
        </div>

        <div class="url-preview">
            URL Base a procesar: <span id="urlPreviewText"></span>
        </div>

        <div style="margin-top: 20px;">
            <button type="button" class="btn-start" id="btnStart" onclick="startScraper()">EJECUTAR SCRAPER</button>
            <button type="button" class="btn-stop" id="btnStop" onclick="stopScraper()" disabled>DETENER</button>
            <span id="status">ESTADO: DETENIDO</span>
        </div>
    </form>

    <h2>Logs en tiempo real:</h2>
    <pre id="logs"></pre>

    <script>
        function getBarrioSlug() {
            const select = document.getElementById('barrioSelect').value;
            if (select === 'custom') {
                const raw = document.getElementById('barrioCustom').value.trim().toLowerCase();
                return raw.replace(/\\s+/g, '-');
            }
            return select;
        }

        function toggleCustomBarrio() {
            const select = document.getElementById('barrioSelect').value;
            document.getElementById('barrioCustom').style.display = (select === 'custom') ? 'block' : 'none';
        }

        function buildBaseUrl() {
            const tipo = document.getElementById('tipoPropiedad').value;
            const op = document.getElementById('operacion').value;
            const barrio = getBarrioSlug() || 'capital-federal';
            return \`https://www.zonaprop.com.ar/\${tipo}-\${op}-\${barrio}.html\`;
        }

        function updateUrlPreview() {
            document.getElementById('urlPreviewText').innerText = buildBaseUrl();
        }

        updateUrlPreview();

        // Conectar a SSE para recibir logs del servidor
        const eventSource = new EventSource('/stream');
        eventSource.onmessage = function(e) {
            const logBox = document.getElementById('logs');
            const data = JSON.parse(e.data);
            logBox.textContent += data + '\\n';
            logBox.scrollTop = logBox.scrollHeight;

            if (data.includes('==== SCRAPER FINALIZADO ====') || data.includes('==== SCRAPER DETENIDO ====')) {
                setRunningState(false);
            }
        };

        function setRunningState(running) {
            document.getElementById('btnStart').disabled = running;
            document.getElementById('btnStop').disabled = !running;
            document.getElementById('status').innerText = running ? 'ESTADO: EJECUTANDO...' : 'ESTADO: DETENIDO';
            document.getElementById('status').style.color = running ? '#00ff00' : '#e0e0e0';
        }

        async function startScraper() {
            const payload = {
                urlBase: buildBaseUrl(),
                paginasMax: document.getElementById('paginasMax').value,
                maxPropiedades: document.getElementById('maxPropiedades').value,
                usarFichaprop: document.getElementById('usarFichaprop').checked,
                dryRun: document.getElementById('dryRun').checked,
                urlPrueba: document.getElementById('urlPrueba').value.trim(),
                cdpUrl: document.getElementById('cdpUrl').value.trim()
            };

            document.getElementById('logs').textContent = "Iniciando proceso...\\n";
            setRunningState(true);

            await fetch('/api/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        async function stopScraper() {
            await fetch('/api/stop', { method: 'POST' });
            setRunningState(false);
        }
    </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(HTML_CONTENT);
    } 
    else if (req.method === 'GET' && req.url === '/stream') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        sseClients.push(res);
        req.on('close', () => {
            sseClients = sseClients.filter(client => client !== res);
        });
    } 
    else if (req.method === 'POST' && req.url === '/api/start') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const data = JSON.parse(body);

            if (scraperProcess) {
                scraperProcess.kill();
            }

            // Preparar variables de entorno para LicenciadoScraper.js
            const env = {
                ...process.env,
                URL_BASE: data.urlBase,
                PAGINAS_MAXIMAS: String(data.paginasMax),
                SCRAPER_MAX_PROPIEDADES: String(data.maxPropiedades),
                USAR_FICHAPROP: data.usarFichaprop ? 'true' : 'false',
                SCRAPER_DRY_RUN: data.dryRun ? 'true' : 'false',
                SCRAPER_URL_PRUEBA: data.urlPrueba,
                CHROME_CDP_URL: data.cdpUrl
            };

            broadcastLog(`[GUI] Lanzas de proceso: node LicenciadoScraper.js`);
            broadcastLog(`[GUI] URL_BASE: ${data.urlBase}`);

            // Ejecutar el archivo script real
            scraperProcess = spawn('node', ['LicenciadoScraper.js'], { env, cwd: __dirname });

            scraperProcess.stdout.on('data', (chunk) => broadcastLog(chunk));
            scraperProcess.stderr.on('data', (chunk) => broadcastLog(`[STDERR] ${chunk}`));

            scraperProcess.on('close', (code) => {
                broadcastLog(`==== SCRAPER FINALIZADO (Código de salida: ${code}) ====`);
                scraperProcess = null;
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        });
    } 
    else if (req.method === 'POST' && req.url === '/api/stop') {
        if (scraperProcess) {
            scraperProcess.kill();
            scraperProcess = null;
            broadcastLog('==== SCRAPER DETENIDO POR EL USUARIO ====');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
    } 
    else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(` Panel Scraper Ejecutándose en: http://localhost:${PORT}`);
    console.log(`==================================================\n`);
});