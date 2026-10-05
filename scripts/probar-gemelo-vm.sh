#!/usr/bin/env bash
#
# probar-gemelo-vm.sh — Prueba E2E del worker de gemelos digitales.
#
# 1. Verifica /api/healthz del worker (y si COLMAP está instalado).
# 2. Genera fotos sintéticas de prueba con ffmpeg.
# 3. Crea un trabajo (POST /api/jobs) y sigue su estado hasta "listo".
# 4. Descarga el .glb y valida que sea un glTF real (magic bytes).
#
# Uso:
#   bash scripts/probar-gemelo-vm.sh [URL_WORKER] [CANT_FOTOS]
#
# Ejemplos:
#   bash scripts/probar-gemelo-vm.sh http://localhost:4000        # worker local
#   bash scripts/probar-gemelo-vm.sh http://1.2.3.4:4000 15       # VM Oracle
#
set -euo pipefail

URL="${1:-http://localhost:4000}"
NFOTOS="${2:-8}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "== 1. Healthz: $URL/api/healthz =="
HEALTH=$(curl -fsS --max-time 15 "$URL/api/healthz")
echo "$HEALTH"
echo "$HEALTH" | grep -q '"ok": *true' || { echo "❌ Worker no sano"; exit 1; }
COLMAP=$(echo "$HEALTH" | grep -o '"colmapInstalado": *[a-z]*' | grep -o 'true\|false')
echo "→ colmapInstalado: $COLMAP"

echo
echo "== 2. Generando $NFOTOS fotos de prueba con ffmpeg en $TMP =="
command -v ffmpeg >/dev/null || { echo "❌ ffmpeg no encontrado en PATH"; exit 1; }
CORES=(red green blue yellow magenta cyan orange violet pink brown navy teal)
for i in $(seq -w 1 "$NFOTOS"); do
  C=${CORES[$(( (10#$i - 1) % ${#CORES[@]} ))]}
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=$C:s=1280x720:d=1" \
    -vf "drawbox=x=$((i * 100)):y=200:w=150:h=150:color=white@0.8:t=fill" \
    -frames:v 1 "$TMP/foto_$i.jpg"
done
ls -la "$TMP" | grep jpg | head -3
echo "→ $NFOTOS fotos listas"

echo
echo "== 3. Creando trabajo: $URL/api/jobs =="
ARGS=(-F "titulo=Prueba E2E automatica")
for f in "$TMP"/foto_*.jpg; do ARGS+=(-F "fotos=@$f"); done
RESP=$(curl -fsS --max-time 30 -X POST "$URL/api/jobs" "${ARGS[@]}")
echo "$RESP"
JOB=$(echo "$RESP" | python -c "import json,sys; print(json.load(sys.stdin)['id'])" 2>/dev/null || true)
[ -n "$JOB" ] || { echo "❌ No se pudo crear el trabajo"; exit 1; }
echo "→ job id: $JOB"

echo
echo "== 4. Siguiendo estado (timeout 15 min) =="
ESTADO=""
for i in $(seq 1 90); do
  sleep 10
  J=$(curl -fsS --max-time 15 "$URL/api/jobs/$JOB")
  read -r ESTADO PCT PASO <<< "$(echo "$J" | python -c "
import json, sys
d = json.load(sys.stdin)
print(d.get('estado', '?'), d.get('progreso', 0), (d.get('etapa') or d.get('mensaje') or '?').replace(' ', '_'))
" 2>/dev/null || echo '? ? ?')"
  echo "[$((i*10))s] estado=$ESTADO progreso=$PCT% etapa=$PASO"
  case "$ESTADO" in
    listo|error|fallido) break ;;
  esac
done

if [ "$ESTADO" != "listo" ]; then
  echo "❌ El trabajo terminó en estado: $ESTADO"
  curl -fsS "$URL/api/jobs/$JOB" || true
  exit 1
fi

echo
echo "== 5. Descargando modelo =="
curl -fsS --max-time 120 "$URL/api/jobs/$JOB/modelo" -o "$TMP/modelo.glb"
SIZE=$(wc -c < "$TMP/modelo.glb")
MAGIC=$(head -c 4 "$TMP/modelo.glb")
echo "→ $SIZE bytes, magic: '$MAGIC'"
if [ "$MAGIC" = "glTF" ]; then
  echo "✅ E2E OK: modelo glTF válido ($SIZE bytes). Job: $JOB"
else
  echo "❌ El archivo descargado no es glTF"
  exit 1
fi
