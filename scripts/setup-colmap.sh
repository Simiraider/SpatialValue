#!/usr/bin/env bash
# Instala ffmpeg y COLMAP (best effort) en Ubuntu/Debian para el worker 3D.
#
# Uso:  sudo bash scripts/setup-colmap.sh
#
# Si COLMAP no está en los repos de la distro, el script imprime las
# alternativas y el worker sigue funcionando en modo simulación.

set -euo pipefail

echo "==> Instalando ffmpeg…"
if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ffmpeg
else
  echo "No se encontró apt-get. Instalá ffmpeg con el gestor de paquetes de tu distro."
fi

echo "==> Instalando COLMAP (best effort)…"
if apt-cache show colmap >/dev/null 2>&1; then
  apt-get install -y colmap || echo "(falló la instalación por apt de colmap)"
else
  echo "El paquete 'colmap' no está en los repos de esta distro."
fi

if command -v colmap >/dev/null 2>&1; then
  # COLMAP >= 3.11 no reconoce `--version`; `colmap help` sí.
  colmap help | head -2
  echo "✅ COLMAP instalado. El worker usará fotogrametría real (GEMELO_MODO=auto)."
else
  cat <<'EOF'
⚠️  COLMAP no quedó instalado. Opciones:

  1) Conda (recomendado):
       conda install -c conda-forge colmap

  2) Build desde fuente (más completo):
       https://colmap.github.io/install.html

Mientras tanto, el worker sigue funcionando en modo simulación:
  GEMELO_MODO=auto   # intenta COLMAP; si no está, genera un modelo de demo
EOF
fi
