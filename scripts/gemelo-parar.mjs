
import { spawnSync } from 'node:child_process';

const SCRIPT =
  "pkill -9 -f 'src/index[.]js' 2>/dev/null; " +
  "sleep 1; " +
  "PIDS=$(ss -ltnp 2>/dev/null | grep ':4000 ' | grep -oP 'pid=\\K[0-9]+' | sort -u); " +
  "[ -n \"$PIDS\" ] && kill -9 $PIDS 2>/dev/null; sleep 1; " +
  "if ss -ltn 2>/dev/null | grep -q ':4000 '; then " +
  "  echo 'aviso: el puerto 4000 sigue ocupado'; " +
  "  ss -ltnp 2>/dev/null | grep ':4000 '; " +
  "else echo 'worker_apagado (puerto 4000 libre)'; fi";

const res = spawnSync(
  'wsl.exe',
  ['-d', 'Ubuntu', '--exec', 'bash', '-c', SCRIPT],
  { stdio: 'inherit', windowsHide: true, timeout: 30000 }
);

process.exit(res.status || 0);
