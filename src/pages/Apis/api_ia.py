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
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

BASE_PATH = Path(__file__).resolve().parent.parent.parent.parent
ENV_PATH = BASE_PATH / ".env.local"
load_dotenv(dotenv_path=ENV_PATH)

DATABASE_URL = (
    os.environ.get("SpatialValueStorage_DATABASE_URL")
    or os.environ.get("DATABASE_URL")
    or os.environ.get("NEON_DATABASE_URL")
)
if not DATABASE_URL:
    raise ValueError(
        "Error: No se encontró la URL de la base de datos. Verificá .env.local "
        "o la variable de entorno en el host (Render/Vercel)."
    )

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
db_pool = psycopg2.pool.ThreadedConnectionPool(1, 20, dsn=DATABASE_URL)
modelo_v4 = None


def _verificar_api_key(x_api_key: str | None) -> None:
    if not INTERNAL_API_KEY:
        return
    if not x_api_key or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="API key inválida")


def _extraer_coordenadas(row):
    """Lee coordenadas guardadas como JSON; no inventa el centro de CABA."""
    lat = pd.to_numeric(row.get("latitud"), errors="coerce")
    lng = pd.to_numeric(row.get("longitud"), errors="coerce")
    if pd.notna(lat) and pd.notna(lng) and lat != 0 and lng != 0:
        return pd.Series([float(lat), float(lng)])

    gps = row.get("coordenadas_gps")
    try:
        if gps:
            coords = json.loads(gps) if isinstance(gps, str) else gps
            lat = pd.to_numeric(coords.get("lat"), errors="coerce")
            lng = pd.to_numeric(coords.get("lng"), errors="coerce")
            if pd.notna(lat) and pd.notna(lng) and lat != 0 and lng != 0:
                return pd.Series([float(lat), float(lng)])
    except (json.JSONDecodeError, TypeError, AttributeError, ValueError):
        pass

    # Cero marca ubicación desconocida durante el entrenamiento; no ubicar
    # silenciosamente cualquier inmueble en el Obelisco.
    return pd.Series([0.0, 0.0])


def _cargar_datos_entrenamiento() -> pd.DataFrame:
    """Entrena solo con precios de publicación observados, no con predicciones IA."""
    conn = db_pool.getconn()
    try:
        query = """
            SELECT
                tipo_propiedad,
                barrio_zona,
                COALESCE(estado, 'Usado') AS estado,
                COALESCE(orientacion, 'No especificada') AS orientacion,
                COALESCE(disposicion, 'No especificada') AS disposicion,
                COALESCE(seguridad_tipo, 'Ninguno') AS seguridad_tipo,
                ambientes,
                dormitorios,
                banos,
                superficie_total_m2,
                superficie_cubierta_m2,
                anios_de_antiguedad,
                piso,
                cochera,
                balcon,
                terraza,
                patio,
                pileta,
                parrilla,
                seguridad_24hs,
                ascensor,
                expensas_ars,
                baulera,
                sum,
                camara,
                gym,
                lounge,
                laundry,
                coordenadas_gps,
                NULL::numeric AS latitud,
                NULL::numeric AS longitud,
                precio_real_usd AS precio_usd
            FROM propiedades
            WHERE precio_real_usd IS NOT NULL
              AND precio_real_usd BETWEEN 100 AND 20000000
              AND (tipo_operacion = 'venta' OR tipo_operacion IS NULL)
        """
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return pd.read_sql_query(query, conn)
    finally:
        db_pool.putconn(conn)


def _preparar_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df[["latitud", "longitud"]] = df.apply(_extraer_coordenadas, axis=1)

    for col in COLUMNAS_TEXTO:
        if col not in df.columns:
            df[col] = "No especificada"
        df[col] = df[col].fillna("No especificada").astype(str)

    for col in COLUMNAS_NUMERICAS:
        if col not in df.columns:
            df[col] = 0
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    return df


def entrenar_modelo() -> None:
    global modelo_v4

    df = _cargar_datos_entrenamiento()
    if df.empty:
        print("No hay precios reales disponibles en propiedades; modelo desactivado.")
        modelo_v4 = None
        return

    df["precio_usd"] = pd.to_numeric(df["precio_usd"], errors="coerce")
    df = df[df["precio_usd"].between(100, 20000000)].copy()
    if df.empty:
        print("No hay precios USD válidos para entrenar; modelo desactivado.")
        modelo_v4 = None
        return

    df = _preparar_features(df)

    # El filtro usa el precio por m² solo para descartar valores extremos.
    # No modifica el precio objetivo ni elimina barrios con pocas muestras.
    superficie = pd.to_numeric(df["superficie_cubierta_m2"], errors="coerce").clip(lower=1)
    precio_m2 = df["precio_usd"] / superficie
    conteo_por_barrio = precio_m2.groupby(df["barrio_zona"]).transform("count")
    q05 = precio_m2.groupby(df["barrio_zona"]).transform(lambda s: s.quantile(0.05))
    q95 = precio_m2.groupby(df["barrio_zona"]).transform(lambda s: s.quantile(0.95))
    grupo_chico = conteo_por_barrio < 20
    dentro_de_rango = precio_m2.between(q05, q95, inclusive="both")

    antes = len(df)
    df = df[grupo_chico | dentro_de_rango].copy()
    print(f"Filtro de outliers por barrio: {antes - len(df)} filas descartadas de {antes}")

    if df.empty:
        print("El filtro dejó el conjunto vacío; modelo desactivado.")
        modelo_v4 = None
        return

    X = df[COLUMNAS_TEXTO + COLUMNAS_NUMERICAS]
    y = df["precio_usd"].astype(float)

    preprocesador = ColumnTransformer(
        transformers=[
            ("texto", OneHotEncoder(handle_unknown="ignore"), COLUMNAS_TEXTO),
            ("numeros", "passthrough", COLUMNAS_NUMERICAS),
        ]
    )

    nuevo_modelo = Pipeline(
        steps=[
            ("preprocesador", preprocesador),
            ("modelo", RandomForestRegressor(
                n_estimators=150,
                min_samples_leaf=2,
                random_state=42,
                n_jobs=-1,
            )),
        ]
    )

    # Para producción se ajusta con todas las filas válidas. El código anterior
    # reservaba un 20% como test pero nunca lo evaluaba ni lo reincorporaba.
    nuevo_modelo.fit(X, y)
    modelo_v4 = nuevo_modelo
    print(f"Modelo entrenado con {len(df)} publicaciones con precio observado.")


try:
    entrenar_modelo()
except Exception as e:
    print(f"Error al entrenar el modelo inicial: {e}")


class PropiedadInput(BaseModel):
    tipo_propiedad: str
    barrio_zona: str
    ambientes: int | None = None
    dormitorios: int | None = None
    banos: int | None = None
    superficie_total_m2: int | None = None
    superficie_cubierta_m2: int | None = None
    estado: str = "Usado"
    anios_de_antiguedad: int | None = None
    piso: int | None = None
    orientacion: str | None = None
    disposicion: str | None = None
    cochera: bool = False
    balcon: bool = False
    terraza: bool = False
    patio: bool = False
    pileta: bool = False
    parrilla: bool = False
    seguridad_24hs: bool = False
    ascensor: bool = False
    expensas_ars: int = 0
    baulera: bool = False
    sum: bool = False
    seguridad_tipo: str = "Ninguno"
    camara: bool = False
    gym: bool = False
    lounge: bool = False
    laundry: bool = False
    latitud: float | None = None
    longitud: float | None = None


@app.get("/")
def health():
    return {
        "status": "ok",
        "servicio": "API IA Estimador SpatialValue",
        "modelo": "listo" if modelo_v4 is not None else "sin datos",
    }


@app.get("/propiedad/{id_propiedad}")
def obtener_propiedad(id_propiedad: str, x_api_key: str | None = Header(default=None)):
    _verificar_api_key(x_api_key)
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM propiedades WHERE id_propiedad = %s", (id_propiedad,))
            fila = cur.fetchone()
            if not fila:
                raise HTTPException(status_code=404, detail="Propiedad no encontrada")
            columnas = [desc[0] for desc in cur.description]
            return dict(zip(columnas, fila))
    finally:
        db_pool.putconn(conn)


@app.post("/estimar-precio")
def estimar_precio(propiedad: PropiedadInput, x_api_key: str | None = Header(default=None)):
    _verificar_api_key(x_api_key)
    coordenadas_validas = propiedad.latitud is not None and propiedad.longitud is not None and propiedad.latitud != 0 and propiedad.longitud != 0
    # Para entrenar/predecir, ubicación desconocida se codifica como 0,0; no como el Obelisco.
    latitud = float(propiedad.latitud) if coordenadas_validas else 0.0
    longitud = float(propiedad.longitud) if coordenadas_validas else 0.0

    if modelo_v4 is None:
        # No devolver un precio ficticio de USD 450: el scraper lo guardaba como
        # si fuera una tasación válida y contaminaba los resultados.
        raise HTTPException(
            status_code=503,
            detail="Modelo sin datos de entrenamiento suficientes; no se generó una estimación.",
        )

    datos_entrada = {
        "tipo_propiedad": [propiedad.tipo_propiedad],
        "barrio_zona": [propiedad.barrio_zona],
        "estado": [propiedad.estado],
        "orientacion": [propiedad.orientacion or "No especificada"],
        "disposicion": [propiedad.disposicion or "No especificada"],
        "seguridad_tipo": [propiedad.seguridad_tipo or "Ninguno"],
        "ambientes": [propiedad.ambientes if propiedad.ambientes is not None else 0],
        "dormitorios": [propiedad.dormitorios if propiedad.dormitorios is not None else 0],
        "banos": [propiedad.banos if propiedad.banos is not None else 0],
        "superficie_total_m2": [propiedad.superficie_total_m2 or 0],
        "superficie_cubierta_m2": [propiedad.superficie_cubierta_m2 or 0],
        "anios_de_antiguedad": [propiedad.anios_de_antiguedad or 0],
        "piso": [propiedad.piso or 0],
        "cochera": [int(propiedad.cochera)],
        "balcon": [int(propiedad.balcon)],
        "terraza": [int(propiedad.terraza)],
        "patio": [int(propiedad.patio)],
        "pileta": [int(propiedad.pileta)],
        "parrilla": [int(propiedad.parrilla)],
        "seguridad_24hs": [int(propiedad.seguridad_24hs)],
        "ascensor": [int(propiedad.ascensor)],
        "expensas_ars": [propiedad.expensas_ars or 0],
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
    precio_predicho = float(modelo_v4.predict(df_input)[0])

    return {
        "status": "success",
        "coordenadas": {"lat": latitud, "lng": longitud} if coordenadas_validas else None,
        "precio_estimado_usd": precio_predicho,
    }


@app.post("/reentrenar")
def reentrenar_api(x_api_key: str | None = Header(default=None)):
    _verificar_api_key(x_api_key)
    try:
        entrenar_modelo()
        return {
            "status": "success" if modelo_v4 is not None else "warning",
            "message": (
                "Modelo reentrenado exitosamente."
                if modelo_v4 is not None
                else "No hay datos válidos suficientes para entrenar el modelo."
            ),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al reentrenar: {e}") from e


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "api_ia:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8000)),
        reload=os.environ.get("RENDER") != "true",
    )
