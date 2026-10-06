#!/usr/bin/env node
/**
 * Wrapper del worker gemelo (WSL) para `npm run dev`.
 *
 * Problema que resuelve: Ctrl+C en la terminal mata los procesos de Windows
 * (concurrently, astro, python y wsl.exe) pero el `node src/index.js` que
 * corre DENTRO de la VM de WSL queda huérfano y sigue ocupando el puerto 4000
 * (de ahí los EADDRINUSE al reiniciar).
 *
 * Solución:
 *  - Al arrancar: mata cualquier worker previo dentro de WSL (auto-curación).
 *  - Al recibir Ctrl+C (SIGINT): mata el worker dentro de WSL antes de salir.
 *  - `npm run gemelo:parar` hace lo mismo manualmente sin levantar el dev.
 *
 * El patrón de pkill usa [.] para que la expresión no matchee su propia
 * línea de comando (clásico footgun de pkill -f).
 */

import { spawn, spawnSync } from 'node:child_process';

const WSL = ['wsl.exe', '-d', 'Ubuntu', '--exec', 'bash', '-c'];
const PATRON = 'watch src/index[.]js';
const ARRANCAR =
  `pkill -f '${PATRON}' 2>/dev/null; sleep 1; ` +
  'cd /home/simon/SpatialValue/server && exec npm run dev';
const MATAR = `pkill -f '${PATRON}' 2>/dev/null; exit 0`;

const hijo = spawn(WSL[0], [...WSL.slice(1), ARRANCAR], {
  stdio: 'inherit',
  windowsHide: true,
});

let limpiando = false;
function limpiar() {
  if (limpiando) return;
  limpiando = true;
  try {
    spawnSync(WSL[0], [...WSL.slice(1), MATAR], { stdio: 'ignore', timeout: 15000 });
  } catch {
    /* best effort */
  }
}

process.on('SIGINT', () => {
  try { hijo.kill('SIGKILL'); } catch { /* ya murió */ }
  limpiar();
  process.exit(130);
});
process.on('SIGTERM', () => {
  try { hijo.kill('SIGKILL'); } catch { /* ya murió */ }
  limpiar();
  process.exit(143);
});
process.on('exit', limpiar);

hijo.on('exit', (code) => {
  // El worker terminó solo (p.ej. error de configuración): propagar el código.
  process.exit(code ?? 0);
});
