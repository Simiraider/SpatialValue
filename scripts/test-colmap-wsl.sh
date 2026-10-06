#!/usr/bin/env bash
# Validación del pipeline COLMAP por etapas con fotos sintéticas (sin worker).
#
# Uso (desde Windows, Git Bash):
#   node scripts/generar-fotos-prueba.mjs "$TEMP/fotos-prueba" 16
#   wsl.exe -d Ubuntu bash -c "bash /mnt/c/Users/simon/Documents/SpatialValue/scripts/test-colmap-wsl.sh"
#
# Todo el trabajo ocurre en /home/simon (persistente entre reinicios de WSL,
# a diferencia de /tmp que se borra cuando la VM se apaga por inactividad).
set -u

FOTOS="${1:-/mnt/c/Users/simon/AppData/Local/Temp/fotos-prueba}"
W=/home/simon/test-gemelo-v4

if [ ! -d "$FOTOS" ]; then
  echo "ERROR: no existe la carpeta de fotos: $FOTOS" >&2
  exit 1
fi

rm -rf "$W"
mkdir -p "$W/imgs" "$W/ws/sparse" # mapper de COLMAP no crea output_path: debe existir
cp "$FOTOS"/*.png "$W/imgs/"
cd "$W" || exit 1
echo "fotos: $(ls imgs | wc -l)"

echo "== 1/3 feature_extractor =="
colmap feature_extractor --database_path ws/database.db --image_path imgs \
  --ImageReader.single_camera 1 \
  --SiftExtraction.max_image_size 1600 --SiftExtraction.max_num_features 8192 \
  > fe.log 2>&1 || { echo "FALLO feature_extractor"; tail -5 fe.log; exit 1; }

echo "== 2/3 exhaustive_matcher =="
colmap exhaustive_matcher --database_path ws/database.db \
  --SiftMatching.guided_matching 1 \
  > fm.log 2>&1 || { echo "FALLO exhaustive_matcher"; tail -5 fm.log; exit 1; }

python3 - <<'PY' || true
import sqlite3
c = sqlite3.connect('ws/database.db')
kp = c.execute('SELECT IFNULL(AVG(rows),0) FROM keypoints').fetchone()[0]
tv = c.execute('SELECT COUNT(*), IFNULL(SUM(rows),0), IFNULL(SUM(rows>=15),0), IFNULL(SUM(rows>=50),0) FROM two_view_geometries').fetchone()
print('keypoints_prom: %d' % round(kp))
print('pares_geom, inliers_totales, pares>=15, pares>=50: %s' % (tv,))
PY

echo "== 3/3 mapper (min_model_size=2) =="
CODE=0
colmap mapper --database_path ws/database.db --image_path imgs --output_path ws/sparse \
  --Mapper.min_model_size 2 --Mapper.init_min_num_inliers 15 \
  --Mapper.ba_global_max_num_iterations 30 \
  > mapper.log 2>&1 || CODE=$?
echo "mapper_exit=$CODE"
echo "imagenes_registradas=$(grep -c 'Registering image #' mapper.log || true)"
if [ -d ws/sparse ] && ls ws/sparse/*/ >/dev/null 2>&1; then
  echo "== modelos sparse =="
  for d in ws/sparse/*/; do
    echo "$d: $(ls "$d" | tr '\n' ' ')"
  done
else
  echo "SPARSE VACIO (mapper no reconstruyo)"
  tail -15 mapper.log
fi
