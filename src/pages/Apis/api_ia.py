import os
import json
import warnings
from pathlib import Path

import pandas as pd
import psycopg2
from psycopg2 import pool
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.impute import SimpleImputer
from modelo_ia.limpieza_datos import limpiar_registros, normalizar_texto
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

BASE_PATH = Path(__file__).resolve().parent.parent.parent.parent
ENV_PATH = BASE_PATH / ".env.local"
load_dotenv(dotenv_path=ENV_PATH)

DATABASE_URL = os.environ.get("SpatialValueStorage_DATABASE_URL")
if not DATABASE_URL:
    raise ValueError(
        "Error: No se encontró DATABASE_URL. Verificá que exista el archivo "
        ".env.local en la raíz del proyecto o que la variable esté configurada "
        "en el host (Render/Vercel)."
    )
COORDENADAS_DEFAULT = {"lat": -34.6037, "lng": -58.3816}

COLUMNAS_TEXTO = [
    "tipo_propiedad",
    "barrio_zona",
    "estado",
    "orientacion",
    "disposicion",
    "seguridad_tipo",
]

COLUMNAS_NUMERICAS = [
    "ambientes",
    "dormitorios",
    "banos",
    "superficie_total_m2",
    "superficie_cubierta_m2",
    "anios_de_antiguedad",
    "piso",
    "cochera",
    "balcon",
    "terraza",
    "patio",
    "pileta",
    "parrilla",
    "seguridad_24hs",
    "ascensor",
    "expensas_ars",
    "baulera",
    "sum",
    "camara",
    "gym",
    "lounge",
    "laundry",
    "latitud",
    "longitud",
]

app = FastAPI(title="API IA Estimador")

INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "")

def _verificar_api_key(x_api_key: str | None) -> None:
    if not INTERNAL_API_KEY:
        return
    if not x_api_key or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="API key inválida")
db_pool = psycopg2.pool.ThreadedConnectionPool(1, 20, dsn=DATABASE_URL)

modelo_v4 = None

def _extraer_coordenadas(row):
    lat, lng = row.get("latitud"), row.get("longitud")
    lat, lng = pd.to_numeric(lat, errors="coerce"), pd.to_numeric(lng, errors="coerce")
    if pd.notna(lat) and pd.notna(lng) and -90 <= lat <= 90 and -180 <= lng <= 180 and (lat, lng) != (0, 0):
        return pd.Series([lat, lng])
    gps = row.get("coordenadas_gps")
    try:
        coords = json.loads(gps) if isinstance(gps, str) else gps
        lat, lng = float(coords["lat"]), float(coords["lng"])
        if -90 <= lat <= 90 and -180 <= lng <= 180 and (lat, lng) != (0, 0):
            return pd.Series([lat, lng])
    except (KeyError, TypeError, ValueError, OverflowError):
        pass
    return pd.Series([float("nan"), float("nan")])


def _cargar_datos_entrenamiento():
    conn = db_pool.getconn()
    try:
        query = """
            SELECT id_propiedad, url,
                tipo_propiedad, barrio_zona, estado, orientacion, disposicion, seguridad_tipo,
                ambientes, dormitorios, banos, superficie_total_m2, superficie_cubierta_m2,
                anios_de_antiguedad, piso, cochera, balcon, terraza, patio, pileta,
                parrilla, seguridad_24hs, ascensor, expensas_ars, baulera, sum,
                camara, gym, lounge, laundry, coordenadas_gps,
                NULL::numeric AS latitud, NULL::numeric AS longitud,
                precio_real_usd AS precio_usd
            FROM propiedades
        """
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return pd.read_sql(query, conn)
    finally:
        db_pool.putconn(conn)


def _preparar_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df[["latitud", "longitud"]] = df.apply(_extraer_coordenadas, axis=1)

    for col in COLUMNAS_TEXTO:
        if col not in df.columns:
            df[col] = "No especificada"
        df[col] = df[col].map(normalizar_texto)

    for col in COLUMNAS_NUMERICAS:
        if col not in df.columns:
            df[col] = float("nan")
        df[col] = pd.to_numeric(df[col], errors="coerce").replace([float("inf"), -float("inf")], float("nan"))

    return df


def entrenar_modelo():
    global modelo_v4

    df = _cargar_datos_entrenamiento()

    registros, informe = limpiar_registros(df.to_dict(orient="records"))
    print(f"Limpieza de entrenamiento: {informe}")
    if len(registros) < 5:
        raise ValueError("Se necesitan al menos 5 registros válidos de venta; se conserva el modelo anterior si existe. Este mínimo no garantiza calidad estadística.")
    df = _preparar_features(pd.DataFrame(registros))
    X = df[COLUMNAS_TEXTO + COLUMNAS_NUMERICAS]
    y = df["precio_usd"]

    preprocesador = ColumnTransformer(
        transformers=[
            ("texto", OneHotEncoder(handle_unknown="ignore"), COLUMNAS_TEXTO),
            ("numeros", SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True), COLUMNAS_NUMERICAS),
        ]
    )

    nuevo_modelo = Pipeline(
        steps=[
            ("preprocesador", preprocesador),
            ("modelo", RandomForestRegressor(n_estimators=100, random_state=42)),
        ]
    )

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    nuevo_modelo.fit(X_train, y_train)

    modelo_v4 = nuevo_modelo
    print("Modelo entrenado con éxito con los datos actuales de Neon")


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
        "status": "ok",
        "servicio": "API IA Estimador SpatialValue",
        "modelo": "listo" if modelo_v4 is not None else "sin datos",
    }


@app.post("/estimar-precio")
def estimar_precio(propiedad: PropiedadInput, x_api_key: str | None = Header(default=None)):
    _verificar_api_key(x_api_key)
    total, cubierta = propiedad.superficie_total_m2, propiedad.superficie_cubierta_m2
    if total is None or cubierta is None or total <= 0 or cubierta <= 0 or cubierta > total:
        raise HTTPException(status_code=422, detail="Se requieren superficies positivas y cubierta menor o igual a total.")
    latitud = propiedad.latitud if propiedad.latitud is not None else COORDENADAS_DEFAULT["lat"]
    longitud = propiedad.longitud if propiedad.longitud is not None else COORDENADAS_DEFAULT["lng"]

    if modelo_v4 is None:
        return {
            "status": "warning",
            "coordenadas": {"lat": latitud, "lng": longitud},
            "precio_estimado_usd": 450.0,
            "message": "Modelo en fase de acumulación de datos inicial.",
        }

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

    return {
        "status": "success",
        "coordenadas": {"lat": latitud, "lng": longitud},
        "precio_estimado_usd": float(precio_predicho),
    }


@app.post("/reentrenar")
def reentrenar_api(x_api_key: str | None = Header(default=None)):
    _verificar_api_key(x_api_key)
    try:
        entrenar_modelo()
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
