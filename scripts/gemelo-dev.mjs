
import { spawn, spawnSync } from 'node:child_process';

const WSL = ['wsl.exe', '-d', 'Ubuntu', '--exec', 'bash', '-c'];
const PATRON = 'src/index[.]js';
const ARRANCAR = `cd /home/simon/SpatialValue/server && exec npm run dev`;
const MATAR = `pkill -9 -f '${PATRON}' 2>/dev/null; exit 0`;
const INTERVALO_MS = 10000;

function workerVivo() {
  const r = spawnSync(
    WSL[0],
    [...WSL.slice(1), 'curl -s -m 3 -o /dev/null -w "%{http_code}" http://localhost:4000/api/healthz'],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 }
  );
  return (r.stdout || '').trim() === '200';
}

function matarRestos() {
  try {
    spawnSync(WSL[0], [...WSL.slice(1), MATAR], { stdio: 'ignore', timeout: 15000 });
  } catch {}
}

let hijo = null;
let monitoreando = true;

function arrancar() {
  console.log('[gemelo] arrancando worker en WSL…');
  hijo = spawn(WSL[0], [...WSL.slice(1), ARRANCAR], {
    stdio: 'inherit',
    windowsHide: true,
  });
  hijo.on('exit', (code) => {
    hijo = null;
    if (monitoreando) console.log(`[gemelo] el worker terminó (código ${code}); reintentando…`);
  });
}

if (workerVivo()) {
  console.log('[gemelo] ya hay un worker corriendo en :4000 â€” se reutiliza.');
} else {
  matarRestos();
  arrancar();
}

const timer = setInterval(() => {
  if (!monitoreando || hijo) return;
  if (workerVivo()) return;
  console.log('[gemelo] el worker no responde; reiniciando…');
  matarRestos();
  arrancar();
}, INTERVALO_MS);

function limpiar() {
  if (!monitoreando) return;
  monitoreando = false;
  clearInterval(timer);
  if (hijo) {
    try { hijo.kill('SIGKILL'); } catch {}
  }
  matarRestos();
}

process.on('SIGINT', () => { limpiar(); process.exit(130); });
process.on('SIGTERM', () => { limpiar(); process.exit(143); });
process.on('exit', limpiar);
