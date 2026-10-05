#!/usr/bin/env bash
#
# setup-gemelo-vm.sh — Aprovisiona una VM Linux (Ubuntu/Debian) con el
# worker de gemelos digitales de SpatialValue corriendo COLMAP real.
#
# Diseñado para Oracle Cloud Always Free (ARM Ampere A1, 2 OCPU / 12 GB RAM)
# pero funciona en cualquier Ubuntu 22.04+/Debian 12+ con Docker.
#
# Uso (en la VM, como root o con sudo):
#   curl -fsSL <url-de-este-script> -o setup.sh && bash setup.sh
#   # o clonando el repo primero:
#   bash scripts/setup-gemelo-vm.sh
#
# Variables opcionales (export antes de correr):
#   GIT_BRANCH   rama a clonar          (default: visor-3d)
#   GIT_TOKEN    token para repo privado (opcional)
#   CORS_ORIGIN  origen del frontend    (default: *, en producción el dominio)
#   WORKER_TOKEN token de admin         (opcional, vacío = sin auth)
#   REPO_URL     url del repo           (default: github.com/Simiraider/SpatialValue)
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Simiraider/SpatialValue.git}"
GIT_BRANCH="${GIT_BRANCH:-visor-3d}"
GIT_TOKEN="${GIT_TOKEN:-}"
CORS_ORIGIN="${CORS_ORIGIN:-*}"
WORKER_TOKEN="${WORKER_TOKEN:-}"
DIR="/opt/spatialvalue"

log() { echo -e "\n\033[1;36m[gemelo-vm]\033[0m $*"; }

[ "$(id -u)" -eq 0 ] || { echo "Correr como root (sudo bash $0)"; exit 1; }

# ---------------------------------------------------------------------------
# 1. Base del sistema + Docker
# ---------------------------------------------------------------------------
log "Instalando Docker y dependencias base..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git iptables-persistent >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
log "Docker: $(docker --version)"

# ---------------------------------------------------------------------------
# 2. Firewall: la imagen Ubuntu de Oracle trae iptables que bloquea todo
#    excepto el 22. Abrimos 4000 y lo persistimos.
# ---------------------------------------------------------------------------
log "Abriendo puerto 4000 en iptables (persistente)..."
iptables -I INPUT 6 -p tcp --dport 4000 -j ACCEPT 2>/dev/null || \
  iptables -I INPUT -p tcp --dport 4000 -j ACCEPT
netfilter-persistent save >/dev/null

# ---------------------------------------------------------------------------
# 3. Código
# ---------------------------------------------------------------------------
CLONE_URL="$REPO_URL"
[ -n "$GIT_TOKEN" ] && CLONE_URL="https://${GIT_TOKEN}@${REPO_URL#https://}"

if [ -d "$DIR/.git" ]; then
  log "Repo existente en $DIR — actualizando..."
  git -C "$DIR" fetch --all
  git -C "$DIR" checkout "$GIT_BRANCH"
  git -C "$DIR" reset --hard "origin/$GIT_BRANCH"
else
  log "Clonando $REPO_URL (rama $GIT_BRANCH) en $DIR..."
  rm -rf "$DIR"
  git clone --depth 1 --branch "$GIT_BRANCH" "$CLONE_URL" "$DIR"
fi

# ---------------------------------------------------------------------------
# 4. Build + run del worker (COLMAP entra por apt dentro del Dockerfile)
# ---------------------------------------------------------------------------
log "Buildeando imagen (incluye ffmpeg + COLMAP; tarda varios minutos)..."
docker build -t spatial-value-gemelo "$DIR/server"

log "Levantando contenedor..."
docker rm -f gemelo 2>/dev/null || true
docker run -d --name gemelo \
  --restart unless-stopped \
  -p 4000:4000 \
  -e GEMELO_MODO=auto \
  -e GEMELO_DATA_DIR=/data \
  -e CORS_ORIGIN="$CORS_ORIGIN" \
  -e WORKER_TOKEN="$WORKER_TOKEN" \
  -v gemelo-data:/data \
  spatial-value-gemelo

# ---------------------------------------------------------------------------
# 5. Verificación
# ---------------------------------------------------------------------------
log "Esperando al worker..."
for i in $(seq 1 30); do
  if curl -fsS http://localhost:4000/api/healthz >/dev/null 2>&1; then break; fi
  sleep 2
done

log "Healthz local:"
curl -fsS http://localhost:4000/api/healthz && echo

PUBLIC_IP=$(curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || echo "<IP-publica-de-la-VM>")
log "Listo. Verificación externa:"
echo "  curl http://$PUBLIC_IP:4000/api/healthz   # debe decir colmapInstalado: true"
echo
echo "Recordá también abrir el puerto 4000 en el Security List de la VCN (consola OCI):"
echo "  Ingress: origen 0.0.0.0/0, protocolo TCP, puerto destino 4000"
echo
echo "Frontend: setear PUBLIC_GEMELO_WORKER_URL=http://$PUBLIC_IP:4000"
