import os
import json
import math
import hashlib
import pickle
import secrets
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from modelo_ia.modelo import (
    cargar_dataset_csv, COLUMNAS_TEXTO, COLUMNAS_NUMERICAS,
    limpiar_registros, _preparar_features, crear_modelo, evaluar_modelo, agrupar_inmuebles,
    DATASET_CSV, CONFIGURACION_MODELO, REVISION_REPUBLICACIONES,
)
from modelo_ia import modelo as modelo_ia

BASE_PATH = Path(__file__).resolve().parent.parent.parent.parent
ENV_PATH = BASE_PATH / ".env.local"
load_dotenv(dotenv_path=ENV_PATH)

app = FastAPI(title="API IA Estimador")

INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "").strip()
EN_PRODUCCION = (
    os.environ.get("RENDER") == "true"
    or os.environ.get("ENVIRONMENT", "").lower() == "production"
    or os.environ.get("NODE_ENV", "").lower() == "production"
)
if EN_PRODUCCION and not INTERNAL_API_KEY:
    raise RuntimeError(
        "INTERNAL_API_KEY es obligatoria en produccion. Definila en el panel de Render."
    )

def _verificar_api_key(x_api_key: str | None) -> None:
    if not INTERNAL_API_KEY:
        return
    if not x_api_key or not secrets.compare_digest(x_api_key, INTERNAL_API_KEY):
        raise HTTPException(status_code=401, detail="API key inválida")

modelo_v4 = None

CODIGO_API = Path(__file__).resolve()
CODIGO_MODELO = Path(modelo_ia.__file__).resolve()
RUTA_CACHE_MODELO = CODIGO_API.parent / ".cache" / "modelo_v4.pkl"
VERSION_CACHE = "4"

def _cargar_datos_entrenamiento():
    return cargar_dataset_csv()


def _huella_entrenamiento():
    """Huella del código de entrenamiento, el dataset, la configuración y las republicaciones."""
    dataset = Path(os.environ.get("MODELO_DATASET_CSV") or DATASET_CSV).expanduser()
    huella = hashlib.sha256(f"v{VERSION_CACHE}".encode())
    for ruta in (CODIGO_API, CODIGO_MODELO, dataset, CONFIGURACION_MODELO, REVISION_REPUBLICACIONES):
        huella.update(str(ruta.resolve()).encode())
        huella.update(ruta.read_bytes() if ruta.is_file() else b"")
    return huella.hexdigest()


def _cargar_modelo_cache(huella):
    """Carga el modelo guardado solo si corresponde a la huella actual."""
    global modelo_v4
    if not RUTA_CACHE_MODELO.is_file():
        return False
    try:
        with RUTA_CACHE_MODELO.open("rb") as archivo:
            guardado = pickle.load(archivo)
    except Exception as e:
        print(f"Caché del modelo ilegible, se reentrena: {e}")
        return False
    if not isinstance(guardado, dict) or guardado.get("huella") != huella or guardado.get("modelo") is None:
        return False
    modelo_v4 = guardado["modelo"]
    return True


def _guardar_modelo_cache(huella):
    RUTA_CACHE_MODELO.parent.mkdir(parents=True, exist_ok=True)
    temporal = RUTA_CACHE_MODELO.with_suffix(".tmp")
    with temporal.open("wb") as archivo:
        pickle.dump({"huella": huella, "modelo": modelo_v4}, archivo, protocol=pickle.HIGHEST_PROTOCOL)
    os.replace(temporal, RUTA_CACHE_MODELO)


def entrenar_modelo(forzar=False):
    global modelo_v4

    huella = _huella_entrenamiento()
    if not forzar and _cargar_modelo_cache(huella):
        print("Modelo cargado del caché en disco: el dataset no cambió desde el último entrenamiento")
        return

    df = _cargar_datos_entrenamiento()

    filas = sorted(df.to_dict(orient="records"), key=lambda r: str(r.get("id_propiedad") or ""))
    registros, informe = limpiar_registros(filas)
    print(f"Limpieza de entrenamiento: {informe}")
    if len(registros) < 20:
        raise ValueError("Se necesitan al menos 20 registros válidos de venta; se conserva el modelo anterior si existe. Este mínimo no garantiza calidad estadística.")
    df = _preparar_features(pd.DataFrame(registros))
    X = df[COLUMNAS_TEXTO + COLUMNAS_NUMERICAS]
    y = df["precio_usd"]

    nuevo_modelo = crear_modelo()

    nuevo_modelo, evaluacion, _ = evaluar_modelo(nuevo_modelo, X, y, grupos=agrupar_inmuebles(pd.DataFrame(registros)), random_state=20261028)
    print("Evaluación del modelo: " + json.dumps(evaluacion, ensure_ascii=False))

    modelo_v4 = nuevo_modelo
    print("Modelo CatBoost entrenado con éxito con el dataset CSV configurado")
    _guardar_modelo_cache(huella)


try:
    entrenar_modelo()
except Exception as e:
    print(f"Error al entrenar el modelo inicial: {e}")

class PropiedadInput(BaseModel):
    tipo_propiedad: str
    barrio_zona: str
    ambientes: int | None
    dormitorios: int | None
    banos: int | None
    superficie_total_m2: int | None
    superficie_cubierta_m2: int | None
    estado: str
    anios_de_antiguedad: int | None
    piso: int | None
    orientacion: str | None
    disposicion: str | None
    cochera: bool
    balcon: bool
    terraza: bool
    patio: bool
    pileta: bool
    parrilla: bool
    seguridad_24hs: bool
    ascensor: bool
    expensas_ars: int
    baulera: bool
    sum: bool
    seguridad_tipo: str
    camara: bool
    gym: bool
    lounge: bool
    laundry: bool
    latitud: float | None = None
    longitud: float | None = None

@app.get("/")
def health():
    return {
        "status": "ok" if modelo_v4 is not None else "degradado",
        "servicio": "API IA Estimador SpatialValue",
        "modelo": "listo" if modelo_v4 is not None else "sin datos",
    }


@app.post("/estimar-precio")
def estimar_precio(propiedad: PropiedadInput, x_api_key: str | None = Header(default=None)):
    _verificar_api_key(x_api_key)
    total, cubierta = propiedad.superficie_total_m2, propiedad.superficie_cubierta_m2
    if total is None or cubierta is None or total <= 0 or cubierta <= 0 or cubierta > total:
        raise HTTPException(status_code=422, detail="Se requieren superficies positivas y cubierta menor o igual a total.")
    for campo in ("ambientes", "dormitorios", "banos", "anios_de_antiguedad", "expensas_ars"):
        valor = getattr(propiedad, campo)
        if valor is not None and (valor < 0 or (campo == "ambientes" and valor == 0)):
            raise HTTPException(status_code=422, detail=f"Valor inválido para {campo}.")
    if propiedad.ambientes is not None and propiedad.dormitorios is not None and propiedad.dormitorios > propiedad.ambientes:
        raise HTTPException(status_code=422, detail="Dormitorios no puede superar ambientes.")
    latitud, longitud = propiedad.latitud, propiedad.longitud
    for valor, limite in ((latitud, 90), (longitud, 180)):
        if valor is not None and (not math.isfinite(valor) or abs(valor) > limite):
            raise HTTPException(status_code=422, detail="Coordenadas inválidas.")

    if modelo_v4 is None:
        raise HTTPException(status_code=503, detail="Modelo no disponible; no se puede producir una tasación.")

    datos_entrada = {
        "tipo_propiedad": [propiedad.tipo_propiedad],
        "barrio_zona": [propiedad.barrio_zona],
        "estado": [propiedad.estado],
        "orientacion": [propiedad.orientacion or "No especificada"],
        "disposicion": [propiedad.disposicion or "No especificada"],
        "seguridad_tipo": [propiedad.seguridad_tipo or "Ninguno"],
        "ambientes": [propiedad.ambientes],
        "dormitorios": [propiedad.dormitorios],
        "banos": [propiedad.banos],
        "superficie_total_m2": [propiedad.superficie_total_m2],
        "superficie_cubierta_m2": [propiedad.superficie_cubierta_m2],
        "anios_de_antiguedad": [propiedad.anios_de_antiguedad],
        "piso": [propiedad.piso],
        "cochera": [int(propiedad.cochera)],
        "balcon": [int(propiedad.balcon)],
        "terraza": [int(propiedad.terraza)],
        "patio": [int(propiedad.patio)],
        "pileta": [int(propiedad.pileta)],
        "parrilla": [int(propiedad.parrilla)],
        "seguridad_24hs": [int(propiedad.seguridad_24hs)],
        "ascensor": [int(propiedad.ascensor)],
        "expensas_ars": [propiedad.expensas_ars],
        "baulera": [int(propiedad.baulera)],
        "sum": [int(propiedad.sum)],
        "camara": [int(propiedad.camara)],
        "gym": [int(propiedad.gym)],
        "lounge": [int(propiedad.lounge)],
        "laundry": [int(propiedad.laundry)],
        "latitud": [propiedad.latitud],
        "longitud": [propiedad.longitud],
    }

    df_input = _preparar_features(pd.DataFrame(datos_entrada))
    df_input = df_input[COLUMNAS_TEXTO + COLUMNAS_NUMERICAS]

    precio_predicho = modelo_v4.predict(df_input)[0]
    if not math.isfinite(float(precio_predicho)) or precio_predicho <= 0:
        raise HTTPException(status_code=503, detail="El modelo no produjo un precio válido.")

    return {
        "status": "success",
        "coordenadas": {"lat": latitud, "lng": longitud} if latitud is not None and longitud is not None else None,
        "precio_estimado_usd": float(precio_predicho),
    }


@app.post("/reentrenar")
def reentrenar_api(x_api_key: str | None = Header(default=None)):
    _verificar_api_key(x_api_key)
    try:
        entrenar_modelo(forzar=True)
        return {"status": "success", "message": "Modelo re-entrenado exitosamente."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "api_ia:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8000)),
        reload=os.environ.get("RENDER") != "true",
    )
