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
        candidatos = [g for g in escena.geometry.values() if len(getattr(g, "vertices", [])) > 0]
        if not candidatos:
            raise RuntimeError("La reconstruccion quedo sin geometria (escena vacia)")
        geom = max(candidatos, key=lambda g: len(g.vertices))
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


def _espaciado_medio(pcd, np):
    from scipy.spatial import cKDTree

    puntos = np.asarray(pcd.points)
    if len(puntos) > 20000:
        idx = np.random.RandomState(0).choice(len(puntos), 20000, replace=False)
        puntos = puntos[idx]
    arbol = cKDTree(puntos)
    dist, _ = arbol.query(puntos, k=2)
    return float(np.median(dist[:, 1]))


def _limpiar_nube(pcd, o3d, np):
    esp = _espaciado_medio(pcd, np)
    if esp <= 0:
        esp = 0.01
    voxel = esp * 1.5
    pcd = pcd.voxel_down_sample(voxel_size=voxel)
    pcd, _ = pcd.remove_statistical_outlier(nb_neighbors=20, std_ratio=1.4)
    pcd, _ = pcd.remove_radius_outlier(nb_points=5, radius=voxel * 4)
    print(f"[dense] limpieza: espaciado={esp:.4f}, voxel={voxel:.4f}, quedan {len(pcd.points)} puntos")
    return pcd, esp


def _aplanar_estructura(puntos, total, o3d, np, esp):
    planos = []
    umbral = max(esp * 2.0, 0.01)
    resto = o3d.geometry.PointCloud()
    resto.points = o3d.utility.Vector3dVector(puntos)
    for _ in range(3):
        if len(resto.points) < 200:
            break
        modelo, inliers = resto.segment_plane(
            distance_threshold=umbral, ransac_n=3, num_iterations=2000
        )
        if len(inliers) < max(150, int(0.06 * total)):
            break
        planos.append(modelo)
        resto = resto.select_by_index(inliers, invert=True)

    for a, b, c, d in planos:
        normal = np.array([a, b, c], dtype=float)
        norma = np.linalg.norm(normal)
        if norma == 0:
            continue
        unitaria = normal / norma
        desplazamiento = d / norma
        firmado = puntos @ unitaria + desplazamiento
        cerca = np.abs(firmado) <= umbral * 1.5
        puntos[cerca] -= np.outer(firmado[cerca], unitaria)
    return puntos, len(planos)


def meshear_si_puede(fused_ply, out_ply):
    try:
        import open3d as o3d
        import numpy as np
    except Exception as e:
        print(f"[dense] meshing omitido (open3d no disponible): {e}")
        return None

    try:
        pcd = o3d.io.read_point_cloud(str(fused_ply))
        n_original = len(pcd.points)
        if n_original < 500:
            print(f"[dense] muy pocos puntos densos ({n_original}) para una malla limpia")
            return None

        pcd, esp = _limpiar_nube(pcd, o3d, np)
        if len(pcd.points) < 300:
            print("[dense] la nube quedo vacia tras el filtrado")
            return None

        puntos = np.asarray(pcd.points).copy()
        puntos, n_planos = _aplanar_estructura(puntos, len(pcd.points), o3d, np, esp)

        colores = np.asarray(pcd.colors) if pcd.has_colors() else None
        limpia = o3d.geometry.PointCloud()
        limpia.points = o3d.utility.Vector3dVector(puntos)
        if colores is not None:
            limpia.colors = o3d.utility.Vector3dVector(colores)

        radio = max(esp * 6.0, 0.02)
        limpia.estimate_normals(
            search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=radio, max_nn=30)
        )
        try:
            limpia.orient_normals_consistent_tangent_plane(30)
        except Exception:
            pass

        profundidad = 8 if len(limpia.points) < 60000 else 9
        malla, densidades = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
            limpia, depth=profundidad
        )
        densidades = np.asarray(densidades)
        if len(densidades):
            corte = float(np.quantile(densidades, 0.08))
            malla.remove_vertices_by_mask(densidades < corte)
        malla.remove_degenerate_triangles()
        malla.remove_duplicated_vertices()
        malla.remove_unreferenced_vertices()
        malla.compute_vertex_normals()

        if colores is not None and len(malla.vertices):
            from scipy.spatial import cKDTree

            arbol = cKDTree(puntos)
            _, idx = arbol.query(np.asarray(malla.vertices), k=1)
            malla.vertex_colors = o3d.utility.Vector3dVector(colores[idx])

        o3d.io.write_triangle_mesh(str(out_ply), malla)
        print(
            f"[dense] malla limpia: {len(malla.vertices)} verts, "
            f"{len(malla.triangles)} caras, {n_planos} planos aplanados "
            f"(de {n_original} puntos densos)"
        )
        return out_ply
    except Exception as e:
        print(f"[dense] meshing fallo: {e}")
        return None


def _reutilizar_sparse(sparse_entrada, output_path):
    import pycolmap

    try:
        for nombre in ("cameras.bin", "images.bin", "points3D.bin", "rigs.bin", "frames.bin"):
            origen = sparse_entrada / nombre
            if origen.exists():
                shutil.copy(str(origen), str(output_path / nombre))

        recon = pycolmap.Reconstruction(str(output_path))
        n_imagenes = _imagenes_registradas(recon)
        n_puntos = len(recon.points3D)
    except Exception as e:
        print(f"[dense] no se pudo leer el sparse recibido ({e}); rehago el SfM")
        _limpiar_carpetas(output_path)
        return None

    if n_imagenes < 4 or n_puntos < 1000:
        print(
            f"[dense] sparse recibido descartado: {n_puntos} puntos, "
            f"{n_imagenes} imagenes (minimo 4 imagenes / 1000 puntos)"
        )
        _limpiar_carpetas(output_path)
        return None

    print(f"[dense] sparse reutilizado: {n_puntos} puntos, {n_imagenes} imagenes")
    return recon


def _imagenes_registradas(recon):
    try:
        return int(recon.num_reg_images())
    except Exception:
        pass
    total = 0
    for imagen in recon.images.values():
        if getattr(imagen, "registered", None) is None:
            total += 1
            continue
        if imagen.registered:
            total += 1
    return total or len(recon.images)


def _limpiar_carpetas(output_path):
    for basura in Path(output_path).glob("*"):
        try:
            basura.unlink(missing_ok=True)
        except Exception:
            pass


def _reset_sparse(database_path, output_path):
    for basura in Path(database_path).glob("*"):
        try:
            basura.unlink(missing_ok=True)
        except Exception:
            pass
    _limpiar_carpetas(output_path)


def _mapping(pycolmap, database_path, image_dir, output_path):
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
        return None
    mejor = max(maps.values(), key=lambda m: len(m.points3D))
    if len(mejor.points3D) == 0:
        return None
    return mejor


def _construir_sparse(pycolmap, database_path, image_dir, output_path, imgs):
    pycolmap.extract_features(
        database_path,
        image_dir,
        camera_mode=pycolmap.CameraMode.SINGLE,
    )
    parece_video = any("frame" in Path(p).name.lower() for p in imgs[:5])

    if parece_video:
        try:
            pycolmap.match_sequential(database_path)
            print("[dense] matching secuencial OK (video)")
            mejor = _mapping(pycolmap, database_path, image_dir, output_path)
            if mejor is not None and len(mejor.images) >= 8:
                mejor.write(output_path)
                print(
                    f"[dense] sparse OK (secuencial): {len(mejor.points3D)} puntos, "
                    f"{len(mejor.images)} imagenes"
                )
                return mejor
            n_reg = len(mejor.images) if mejor is not None else 0
            print(f"[dense] el secuencial registro {n_reg} imagenes; reintento con exhaustivo")
        except Exception as e:
            print(f"[dense] secuencial no disponible ({e})")

    _reset_sparse(database_path, output_path)
    pycolmap.extract_features(
        database_path,
        image_dir,
        camera_mode=pycolmap.CameraMode.SINGLE,
    )
    pycolmap.match_exhaustive(database_path)
    mejor = _mapping(pycolmap, database_path, image_dir, output_path)
    if mejor is None:
        escribir_estado(etapa="error", error="La reconstruccion sparse no produjo modelos")
        return None
    mejor.write(output_path)
    print(
        f"[dense] sparse OK (exhaustivo): {len(mejor.points3D)} puntos, "
        f"{len(mejor.images)} imagenes"
    )
    return mejor


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

        mejor = _reutilizar_sparse(sparse_entrada, output_path) if sparse_entrada else None

        if mejor is None:
            mejor = _construir_sparse(pycolmap, database_path, image_dir, output_path, imgs)
            if mejor is None:
                return
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
