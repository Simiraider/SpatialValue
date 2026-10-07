# Reconstrucción densa en GPU gratis con Kaggle

Esta guía deja el gemelo digital en **alta calidad (nube densa)** usando la GPU
gratuita de Kaggle. El worker local hace el *sparse* (lo que ya hace) y Kaggle
hace el *dense* con CUDA.

> **Costo: $0.** Kaggle regala ~30 h/semana de GPU (NVIDIA T4/P100, 16 GB) y su
> API está pensada para automatizar notebooks.

---

## 1. Requisitos (una sola vez)

1. Crear una cuenta en https://www.kaggle.com
2. **Verificar el teléfono** (Account → Phone Verification). Sin esto no hay GPU.
3. **Crear el API token**: Account → API → *Create New Token*. Kaggle ahora
   muestra un token `KGAT_...`. Tenés dos formas de guardarlo:

   **Opción A (recomendada):** guardarlo en `~/.kaggle/access_token`
   ```bash
   mkdir -p ~/.kaggle
   echo 'KGAT_tu_token' > ~/.kaggle/access_token
   chmod 600 ~/.kaggle/access_token
   ```

   **Opción B:** variable de entorno `KAGGLE_API_TOKEN=KGAT_tu_token`.

   > El `kaggle.json` clásico (username+key) también sigue soportado.

## 2. Instalar la CLI de Kaggle en WSL

```bash
pip3 install --user kaggle
kaggle --version   # debe responder
```

> También podés usar variables de entorno en `server/.env`:
> `KAGGLE_API_TOKEN=KGAT_...` (o `KAGGLE_USERNAME` + `KAGGLE_KEY`).

## 3. Publicar el kernel una vez

El kernel vive en `kaggle/dense-colmap/`. Poné tu usuario en el `id` de
`kernel-metadata.json`.

```bash
cd /home/simon/SpatialValue
kaggle kernels push -p kaggle/dense-colmap
kaggle kernels status TU_USUARIO/spatial-value-dense
```

> **Ojo con el slug:** Kaggle puede crear el kernel con un id derivado del
> **título**, no del `id` que pusiste. Mirá el resultado del push: si dice
> `https://www.kaggle.com/code/TU_USUARIO/otro-slug`, usá ese slug en
> `GEMELO_KAGGLE_KERNEL_ID`. Ejemplo real de esta puesta a punto: el id pedido
> `simonflomenboim/spatial-value-dense` quedó como
> `simonflomenboim/spatial-value-dense-colmap-gpu`.

## 4. Activar en el worker

En `server/.env`:

```env
GEMELO_MODO=auto
GEMELO_DENSE=kaggle
GEMELO_KAGGLE_KERNEL_ID=TU_USUARIO/spatial-value-dense
GEMELO_KAGGLE_DATASET=TU_USUARIO/spatial-value-input
KAGGLE_USERNAME=TU_USUARIO
KAGGLE_API_TOKEN=KGAT_tu_token_nuevo
```

> Con el token nuevo (`KGAT_...`) el token **no incluye tu usuario**, por eso
> además hace falta `KAGGLE_USERNAME=TU_USUARIO` (tu usuario de Kaggle).

Reiniciá el worker y verificá:

```bash
curl http://localhost:4000/api/healthz
# debe decir "denseHabilitado": true y "kaggleListo": true
```

## 5. Probar

Subí un video o fotos desde `/gemelo-digital`. El progreso ahora muestra un paso
**"Refinando en GPU"**. Al terminar, el `.glb` es la reconstrucción **densa**
(nube con color de las fotos, o malla si el meshing pudo correr).

---

## Cómo funciona (resumen técnico)

1. El worker local extrae frames (ffmpeg) y corre COLMAP sparse.
2. `server/src/services/nube/denso.js` empaqueta las imágenes + el sparse y:
   - sube un **dataset** a Kaggle (`kaggle datasets create/version`),
   - hace `kaggle kernels push` (lanza el notebook con GPU),
   - espera con `kaggle kernels status` y baja el `modelo.glb` con
     `kaggle kernels output`.
3. El notebook `kaggle/dense-colmap/dense_colmap.py` corre en la GPU:
   `extract_features → match → incremental_mapping → undistort_images →
   patch_match_stereo → stereo_fusion` (+ Poisson opcional) y exporta `.glb`.
4. Si Kaggle falla, no hay credenciales o se agotó la cuota, el worker **sigue
   con la nube sparse local** y avisa por el estado. Nunca rompe el trabajo.

## Límites y advertencias

- **Cuota**: ~30 h/semana de GPU. Si se agota, el densificado se saltea.
- **Privacidad**: las imágenes del usuario **se suben a Kaggle**. El proyecto
  promete "no guardar fotos"; con densificado activo hay que avisarlo en la UI.
- **Latencia**: cada reconstrucción suma el arranque del kernel (minutos) + el
  dense. Es notablemente más lento que el sparse solo.
- **No es un servidor**: Kaggle ejecuta un *job*; si falla, hay que reintentar.

## Requisitos de Kaggle que suelen morder

1. **Verificar el teléfono** (Account → Phone Verification). Sin esto:
   - no hay GPU, y
   - **no hay internet** en el kernel (pip falla con `Temporary failure in name
     resolution`). Aunque `enable_internet: true` esté en la metadata.
2. **`pycolmap-cuda12`**: es el wheel de COLMAP con CUDA. El kernel desinstala
   el `pycolmap` sin CUDA que Kaggle trae y instala este.
3. **API de pycolmap 4.2** (cambió respecto de versiones viejas):
   - una sola cámara → `extract_features(..., camera_mode=pycolmap.CameraMode.SINGLE)`
     (ya **no** existe `reader_options.single_camera`),
   - fusión a PLY → `stereo_fusion(salida, mvs_path, output_type="ply")`
     (el default `bin` espera un directorio).
   El kernel ya está escrito para esta versión.
