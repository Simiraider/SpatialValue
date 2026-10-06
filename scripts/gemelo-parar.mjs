#!/usr/bin/env node
/**
 * Apaga el worker gemelo que corre dentro de WSL (npm run gemelo:parar).
 * Complemento de scripts/gemelo-dev.mjs — mismo patrón de proceso.
 * El patrón usa [.] para que pkill no matchee su propia línea de comando.
 */

import { spawnSync } from 'node:child_process';

const res = spawnSync(
  'wsl.exe',
  [
    '-d', 'Ubuntu',
    '--exec', 'bash', '-c',
    "pkill -f 'watch src/index[.]js' 2>/dev/null; sleep 1; " +
      "ss -ltn | grep -q ':4000 ' && echo 'aviso: el puerto 4000 sigue ocupado' || echo worker_apagado",
  ],
  { stdio: 'inherit', windowsHide: true, timeout: 30000 }
);

process.exit(res.status || 0);
