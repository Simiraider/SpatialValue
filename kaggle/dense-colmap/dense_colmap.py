import json
import os
import shutil
import sys
import traceback
from pathlib import Path

WORK = Path("/kaggle/working")
STATUS = WORK / "estado.json"


def escribir_estado(**kw):
    try:
        WORK.mkdir(parents=True, exist_ok=True)
        STATUS.write_text(json.dumps(kw, indent=2), encoding="utf8")
    except Exception:
        pass


def buscar_imagenes():
    exts = (".jpg", ".jpeg", ".png", ".webp")
    destino = Path("/kaggle/working/_input")
    destino.mkdir(parents=True, exist_ok=True)

    import zipfile

    for raiz, _, archivos in os.walk("/kaggle/input"):
        for nombre in archivos:
            if nombre.lower().endswith(".zip"):
                try:
                    with zipfile.ZipFile(os.path.join(raiz, nombre)) as z:
                        z.extractall(destino)
                except Exception as e:
                    print(f"[dense] no pude descomprimir {nombre}: {e}")

    imgs = []
    for raiz in ("/kaggle/input", str(destino)):
        for dirpath, _, archivos in os.walk(raiz):
            for nombre in archivos:
                if nombre.lower().endswith(exts):
                    imgs.append(os.path.join(dirpath, nombre))
    return sorted(set(imgs))


def instalar_pycolmap_cuda():
    import subprocess

    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-U", "pip"], check=False)
    subprocess.run([sys.executable, "-m", "pip", "uninstall", "-y", "pycolmap"], check=False)

    for paquete in ("pycolmap-cuda12", "pycolmap"):
        print(f"[dense] instalando {paquete}…")
        r = subprocess.run(
            [sys.executable, "-m", "pip", "install", "--force-reinstall", paquete],
            text=True,
            capture_output=True,
        )
        salida = (r.stdout or "") + (r.stderr or "")
        print(salida[-1500:])
        if r.returncode != 0:
            print(f"[dense] {paquete} fallo (codigo {r.returncode})")
            if "name resolution" in salida or "Connection" in salida:
                print(
                    "[dense] SIN INTERNET en el kernel. Verificá el teléfono en "
                    "https://www.kaggle.com/settings (Phone Verification): Kaggle "
                    "bloquea la red de los notebooks hasta verificar el número."
                )
            continue
        chk = subprocess.run(
            [sys.executable, "-c", "import pycolmap; print('patch', hasattr(pycolmap,'patch_match_stereo'))"],
            text=True,
            capture_output=True,
        )
        print(chk.stdout.strip(), chk.stderr.strip()[-200:])
        try:
            import importlib
            import pycolmap  # noqa: F401

            importlib.reload(pycolmap)
            if hasattr(pycolmap, "patch_match_stereo"):
                print(f"[dense] pycolmap listo via {paquete} (con dense)")
            else:
                print(f"[dense] pycolmap via {paquete} sin patch_match_stereo")
            return True
        except Exception as e:
            print(f"[dense] {paquete} instalo pero no importa: {e}")
    return False


def exportar_glb(ply_path, glb_path):
    import trimesh
    import numpy as np

    escena = trimesh.load(str(ply_path), process=False)

    if isinstance(escena, trimesh.Scene):
        geom = max(escena.geometry.values(), key=lambda g: len(g.vertices))
    else:
        geom = escena

    vertices = np.asarray(geom.vertices)
    if len(vertices) == 0:
        raise RuntimeError("La malla densa quedo sin vertices")

    colores = None
    try:
        vc = getattr(geom.visual, "vertex_colors", None)
        if vc is not None and len(vc) == len(vertices):
            colores = np.asarray(vc)[:, :3].astype(np.uint8)
    except Exception:
        colores = None

    caras = None
    try:
        caras = np.asarray(geom.faces)
        if len(caras) == 0:
            caras = None
    except Exception:
        caras = None

    if colores is None:
        colores = np.full((len(vertices), 4), 200, dtype=np.uint8)

    if caras is not None:
        malla = trimesh.Trimesh(vertices=vertices, faces=caras, process=False)
        malla.visual.vertex_colors = colores[:, :4] if colores.shape[1] == 4 else np.c_[colores, np.full(len(colores), 255, np.uint8)]
        malla.export(str(glb_path))
        return {"modo": "malla", "vertices": int(len(vertices)), "caras": int(len(caras))}

    nube = trimesh.points.PointCloud(vertices, colors=colores[:, :3])
    nube.export(str(glb_path))
    return {"modo": "nube", "vertices": int(len(vertices)), "caras": 0}


def meshear_si_puede(fused_ply, out_ply):
    try:
        import open3d as o3d
        import numpy as np

        pcd = o3d.io.read_point_cloud(str(fused_ply))
        pcd.estimate_normals()
        malla, _ = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(pcd, depth=9)
        malla.compute_vertex_normals()
        colores = np.asarray(pcd.colors)
        if len(colores) and len(malla.vertices):
            from scipy.spatial import cKDTree

            arbol = cKDTree(np.asarray(pcd.points))
            _, idx = arbol.query(np.asarray(malla.vertices), k=1)
            malla.vertex_colors = o3d.utility.Vector3dVector(colores[idx])
        o3d.io.write_triangle_mesh(str(out_ply), malla)
        return out_ply
    except Exception as e:
        print(f"[dense] meshing opcional omitido: {e}")
        return None


def main():
    escribir_estado(etapa="iniciando")
    imgs = buscar_imagenes()
    if len(imgs) < 3:
        escribir_estado(etapa="error", error=f"Solo {len(imgs)} imagenes encontradas en /kaggle/input")
        return

    print(f"[dense] {len(imgs)} imagenes")
    escribir_estado(etapa="instalando", imagenes=len(imgs))

    if not instalar_pycolmap_cuda():
        escribir_estado(
            etapa="error",
            error=(
                "No se pudo instalar pycolmap con CUDA. Causa más probable: el kernel "
                "no tiene internet. Verificá el teléfono en https://www.kaggle.com/settings "
                "(Phone Verification) y volvé a ejecutar."
            ),
        )
        return

    import subprocess

    print("[dense] instalando trimesh…")
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "trimesh", "scipy"], check=False)
    print("[dense] instalando open3d (meshing)…")
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "open3d"], check=False)

    import pycolmap

    pycolmap.set_random_seed(0)

    work = WORK / "colmap"
    image_dir = work / "images"
    output_path = work / "sparse"
    mvs_path = work / "mvs"
    database_path = work / "database.db"
    for d in (image_dir, output_path, mvs_path):
        d.mkdir(parents=True, exist_ok=True)

    for p in imgs:
        try:
            shutil.copy(str(p), str(image_dir / Path(p).name))
        except Exception:
            pass

    try:
        escribir_estado(etapa="sparse")
        sparse_entrada = None
        for raiz_busqueda in ("/kaggle/input", "/kaggle/working/_input"):
            for raiz, _, archivos in os.walk(raiz_busqueda):
                if "cameras.bin" in archivos and "images.bin" in archivos:
                    sparse_entrada = Path(raiz)
                    break
            if sparse_entrada is not None:
                break

        if sparse_entrada is not None:
            for nombre in ("cameras.bin", "images.bin", "points3D.bin", "rigs.bin", "frames.bin"):
                origen = sparse_entrada / nombre
                if origen.exists():
                    shutil.copy(str(origen), str(output_path / nombre))
            mejor = pycolmap.Reconstruction(str(output_path))
            print(f"[dense] sparse reutilizado: {len(mejor.points3D)} puntos, {len(mejor.images)} imagenes")
        else:
            pycolmap.extract_features(
                database_path,
                image_dir,
                camera_mode=pycolmap.CameraMode.SINGLE,
            )
            parece_video = any("frame" in Path(p).name.lower() for p in imgs[:5])
            emparejado = False
            if parece_video:
                try:
                    pycolmap.match_sequential(database_path)
                    print("[dense] matching secuencial OK (video)")
                    emparejado = True
                except Exception as e:
                    print(f"[dense] secuencial no disponible ({e})")
            if not emparejado:
                pycolmap.match_exhaustive(database_path)

            opciones = pycolmap.IncrementalPipelineOptions()
            opciones.min_model_size = 2
            opciones.multiple_models = True
            opciones.mapper.init_min_num_inliers = 15
            opciones.mapper.abs_pose_min_num_inliers = 10
            opciones.mapper.init_min_tri_angle = 4.0
            maps = pycolmap.incremental_mapping(
                database_path, image_dir, output_path, options=opciones
            )
            if not maps:
                escribir_estado(etapa="error", error="La reconstruccion sparse no produjo modelos")
                return
            mejor = max(maps.values(), key=lambda m: len(m.points3D))
            if len(mejor.points3D) == 0:
                escribir_estado(etapa="error", error="El modelo sparse quedo sin puntos 3D")
                return
            mejor.write(output_path)
            print(f"[dense] sparse OK: {len(mejor.points3D)} puntos, {len(mejor.images)} imagenes")
    except Exception as e:
        escribir_estado(etapa="error", error=f"Sparse fallo: {e}", traza=traceback.format_exc()[-2000:])
        return

    glb_path = WORK / "modelo.glb"
    try:
        escribir_estado(etapa="densificando", sparse_puntos=len(mejor.points3D))
        pycolmap.undistort_images(mvs_path, output_path, image_dir)
        pycolmap.patch_match_stereo(mvs_path)
        fused = mvs_path / "fused.ply"
        pycolmap.stereo_fusion(fused, mvs_path, output_type="ply")
    except Exception as e:
        escribir_estado(etapa="error", error=f"Dense fallo: {e}", traza=traceback.format_exc()[-2000:])
        return

    if not (mvs_path / "fused.ply").exists():
        escribir_estado(etapa="error", error="stereo_fusion no generó la nube densa")
        return

    escribir_estado(etapa="convirtiendo")
    fuente = mvs_path / "fused.ply"
    malla = meshear_si_puede(fuente, mvs_path / "mesh.ply")
    if malla:
        fuente = malla

    try:
        info = exportar_glb(fuente, glb_path)
    except Exception as e:
        escribir_estado(etapa="error", error=f"GLB fallo: {e}", traza=traceback.format_exc()[-2000:])
        return

    escribir_estado(etapa="listo", archivo="modelo.glb", **info)

    for basura in ("colmap", "images", "_input"):
        try:
            shutil.rmtree(WORK / basura, ignore_errors=True)
        except Exception:
            pass
    try:
        for extra in WORK.glob("*.ply"):
            extra.unlink(missing_ok=True)
    except Exception:
        pass


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        escribir_estado(etapa="error", error=str(e), traza=traceback.format_exc()[-2000:])
