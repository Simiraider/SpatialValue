import os
import json
import secrets
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

INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "").strip()
EN_PRODUCCION = (
    os.environ.get("RENDER") == "true"
    or os.environ.get("ENVIRONMENT") == "production"
    or os.environ.get("NODE_ENV") == "production"
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
db_pool = psycopg2.pool.ThreadedConnectionPool(1, 20, dsn=DATABASE_URL)

modelo_v4 = None

def _extraer_coordenadas(row):
    lat = pd.to_numeric(row.get("latitud"), errors="coerce")
    lng = pd.to_numeric(row.get("longitud"), errors="coerce")
    if pd.notna(lat) and pd.notna(lng) and lat != 0 and lng != 0:
        return pd.Series([float(lat), float(lng)])

    gps = row.get("coordenadas_gps")
    try:
        if gps:
            coords = json.loads(gps) if isinstance(gps, str) else gps
            return pd.Series([
                float(coords.get("lat", COORDENADAS_DEFAULT["lat"])),
                float(coords.get("lng", COORDENADAS_DEFAULT["lng"])),
            ])
    except (json.JSONDecodeError, TypeError, AttributeError, ValueError):
        pass
    return pd.Series([COORDENADAS_DEFAULT["lat"], COORDENADAS_DEFAULT["lng"]])


def _cargar_datos_entrenamiento():
    conn = db_pool.getconn()
    try:
        query = """
            WITH datos_scraper AS (
                SELECT
                    tipo_propiedad, barrio_zona, estado, orientacion, disposicion, seguridad_tipo,
                    ambientes, dormitorios, banos, superficie_total_m2, superficie_cubierta_m2,
                    anios_de_antiguedad, piso, cochera, balcon, terraza, patio, pileta,
                    parrilla, seguridad_24hs, ascensor, expensas_ars, baulera, sum,
                    camara, gym, lounge, laundry, coordenadas_gps,
                    NULL::numeric AS latitud, NULL::numeric AS longitud,
                    precio_real_usd AS precio_usd
                FROM propiedades
                WHERE precio_real_usd IS NOT NULL
            ),
            datos_usuarios AS (
                SELECT
                    p.tipo_propiedad,
                    p.barrio AS barrio_zona,
                    COALESCE(p.estado, 'Usado') AS estado,
                    COALESCE(d.datos->>'orientacion', 'No especificada') AS orientacion,
                    COALESCE(d.datos->>'disposicion', 'No especificada') AS disposicion,
                    CASE WHEN COALESCE(d.datos->'comodidades' ? 'Seguridad 24h', false) THEN '24hs' ELSE 'Ninguno' END AS seguridad_tipo,
                    p.ambientes, p.dormitorios, p.banos,
                    p.superficie_total AS superficie_total_m2,
                    p.superficie_cubierta AS superficie_cubierta_m2,
                    (CASE WHEN d.datos->>'antiguedad' ~ '^[0-9]+$' THEN (d.datos->>'antiguedad')::int END) AS anios_de_antiguedad,
                    NULL::int AS piso,
                    COALESCE(d.datos->'comodidades' ? 'Cochera', false) AS cochera,
                    COALESCE(d.datos->'comodidades' ? 'Balcón', false) AS balcon,
                    COALESCE(d.datos->'comodidades' ? 'Terraza', false) AS terraza,
                    COALESCE(d.datos->'comodidades' ? 'Patio', false) AS patio,
                    COALESCE(d.datos->'comodidades' ? 'Pileta', false) AS pileta,
                    COALESCE(d.datos->'comodidades' ? 'Parrilla', false) AS parrilla,
                    COALESCE(d.datos->'comodidades' ? 'Seguridad 24h', false) AS seguridad_24hs,
                    COALESCE(d.datos->'comodidades' ? 'Ascensor', false) AS ascensor,
                    p.expensas AS expensas_ars,
                    COALESCE(d.datos->'comodidades' ? 'Baulera', false) AS baulera,
                    COALESCE(d.datos->'comodidades' ? 'SUM', false) AS sum,
                    COALESCE(d.datos->'comodidades' ? 'Cámaras', false) AS camara,
                    COALESCE(d.datos->'comodidades' ? 'Gimnasio', false) AS gym,
                    COALESCE(d.datos->'comodidades' ? 'Lounge', false) AS lounge,
                    COALESCE(d.datos->'comodidades' ? 'Laundry', false) AS laundry,
                    NULL::text AS coordenadas_gps,
                    p.latitud, p.longitud,
                    p.precio_estimado_ia AS precio_usd
                FROM publicaciones p
                LEFT JOIN tasacion_detalles d ON d.id_publicacion = p.id_publicacion::text
                WHERE p.precio_estimado_ia IS NOT NULL
                  AND p.tipo_operacion = 'venta'
                  AND COALESCE(d.datos->>'fuente_precio', '') = 'ia'
            )
            SELECT * FROM datos_scraper
            UNION ALL
            SELECT * FROM datos_usuarios
        """
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return pd.read_sql(query, conn)
    finally:
        db_pool.putconn(conn)


def _preparar_features(df: pd.DataFrame) -> pd.DataFrame:
    df[["latitud", "longitud"]] = df.apply(_extraer_coordenadas, axis=1)

    for col in COLUMNAS_TEXTO:
        if col not in df.columns:
            df[col] = "No especificada"
        df[col] = df[col].fillna("No especificada")

    for col in COLUMNAS_NUMERICAS:
        if col not in df.columns:
            df[col] = 0
        df[col] = df[col].fillna(0)

    return df


def _huella_entrenamiento():
    """Huella del código de entrenamiento, el dataset, la configuración y las republicaciones."""
    dataset = Path(os.environ.get("MODELO_DATASET_CSV") or DATASET_CSV).expanduser()
    huella = hashlib.sha256(f"v{VERSION_CACHE}".encode())
    for ruta in (CODIGO_MODELO, dataset, CONFIGURACION_MODELO, REVISION_REPUBLICACIONES):
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

    df = cargar_dataset_csv()

    if df.empty:
        print("La base de datos de Neon está vacía")
        modelo_v4 = None
        return

    df = _preparar_features(df)

    precios = pd.to_numeric(df["precio_usd"], errors="coerce")
    superficies = pd.to_numeric(df["superficie_cubierta_m2"], errors="coerce").clip(lower=1)
    df = df.assign(precio_m2=precios / superficies)

    antes = len(df)
    q1 = df.groupby("barrio_zona")["precio_m2"].transform(lambda s: s.quantile(0.05) if len(s) >= 20 else s.min())
    q3 = df.groupby("barrio_zona")["precio_m2"].transform(lambda s: s.quantile(0.95) if len(s) >= 20 else s.max())
    df = df[(df["precio_m2"] >= q1) & (df["precio_m2"] <= q3)]
    df = df.drop(columns=["precio_m2"])
    print(f"Filtro de outliers por barrio: {antes - len(df)} filas descartadas de {antes}")

    X = df[COLUMNAS_TEXTO + COLUMNAS_NUMERICAS]
    y = df["precio_usd"].fillna(df["precio_usd"].median())

    preprocesador = ColumnTransformer(
        transformers=[
            ("texto", OneHotEncoder(handle_unknown="ignore"), COLUMNAS_TEXTO),
            ("numeros", "passthrough", COLUMNAS_NUMERICAS),
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
    latitud = propiedad.latitud if propiedad.latitud is not None else COORDENADAS_DEFAULT["lat"]
    longitud = propiedad.longitud if propiedad.longitud is not None else COORDENADAS_DEFAULT["lng"]

    if modelo_v4 is None:
        raise HTTPException(
            status_code=503,
            detail="El modelo todavía no cuenta con datos suficientes para estimar un precio.",
        )

    datos_entrada = {
        "tipo_propiedad": [propiedad.tipo_propiedad],
        "barrio_zona": [propiedad.barrio_zona],
        "estado": [propiedad.estado],
        "orientacion": [propiedad.orientacion or "No especificada"],
        "disposicion": [propiedad.disposicion or "No especificada"],
        "seguridad_tipo": [propiedad.seguridad_tipo or "Ninguno"],
        "ambientes": [propiedad.ambientes or 1],
        "dormitorios": [propiedad.dormitorios or 1],
        "banos": [propiedad.banos or 1],
        "superficie_total_m2": [propiedad.superficie_total_m2 or 45],
        "superficie_cubierta_m2": [propiedad.superficie_cubierta_m2 or 40],
        "anios_de_antiguedad": [propiedad.anios_de_antiguedad or 10],
        "piso": [propiedad.piso or 1],
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
        "latitud": [latitud],
        "longitud": [longitud],
    }

    df_input = pd.DataFrame(datos_entrada)
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
        entrenar_modelo(forzar=True)
        return {"status": "success", "message": "Modelo re-entrenado exitosamente."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


if __name__ == "__main__":
    import uvicorn

    # PORT vacío o 0 haría que uvicorn elija un puerto al azar y el front no lo encuentre.
    puerto = int(os.environ.get("PORT") or 0) or 8000

    uvicorn.run(
        "api_ia:app",
        host="0.0.0.0",
        port=puerto,
        reload=os.environ.get("RENDER") != "true",
        reload_includes=["*.py"],
        reload_dirs=[os.path.dirname(os.path.abspath(__file__))],
    )
