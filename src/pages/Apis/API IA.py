import os
import json
from pathlib import Path
from fastapi import FastAPI
from pydantic import BaseModel
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
from sklearn.pipeline import Pipeline
from sklearn.ensemble import RandomForestRegressor
import psycopg2
from psycopg2 import pool
from dotenv import load_dotenv

base_path = Path(__file__).resolve().parent.parent.parent.parent
env_path = base_path / ".env.local"
load_dotenv(dotenv_path=env_path)

app = FastAPI(title="API IA Estimador")

DATABASE_URL = os.environ.get("SpatialValueStorage_DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("❌ Error: No se encontró DATABASE_URL. Verificá que exista el archivo .env.local en la raíz del proyecto.")

db_pool = psycopg2.pool.ThreadedConnectionPool(1, 20, dsn=DATABASE_URL)

columnas_texto = [
    "tipo_propiedad",
    "barrio_zona",
    "estado",
    "orientacion",
    "disposicion",
    "seguridad_tipo"
]

columnas_numericas = [
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
    "longitud"
]

modelo_v4 = None

def entrenar_modelo():
    global modelo_v4
    conn = db_pool.getconn()
    try:
        query = """
            SELECT 
                tipo_propiedad, barrio_zona, estado, orientacion, disposicion, seguridad_tipo,
                ambientes, dormitorios, banos, superficie_total_m2, superficie_cubierta_m2,
                anios_de_antiguedad, piso, cochera, balcon, terraza, patio, pileta,
                parrilla, seguridad_24hs, ascensor, expensas_ars, baulera, sum,
                camara, gym, lounge, laundry, coordenadas_gps, precio_real_usd AS precio_usd
            FROM propiedades 
            WHERE precio_real_usd IS NOT NULL;
        """
        df = pd.read_sql(query, conn)
    finally:
        db_pool.putconn(conn)

    if df.empty or len(df) < 2:
        print("⚠️ Advertencia: La base de datos de Neon está vacía o tiene muy pocos datos.")
        modelo_v4 = None
        return

    def extraer_coordenadas(row):
        try:
            if row['coordenadas_gps']:
                coords = json.loads(row['coordenadas_gps'])
                return pd.Series([coords.get('lat', -34.6037), coords.get('lng', -58.3816)])
        except:
            pass
        return pd.Series([-34.6037, -58.3816])

    df[['latitud', 'longitud']] = df.apply(extraer_coordenadas, axis=1)

    for col in columnas_texto:
        if col not in df.columns:
            df[col] = "No especificada"
        df[col] = df[col].fillna("No especificada")

    for col in columnas_numericas:
        if col not in df.columns:
            df[col] = 0
        df[col] = df[col].fillna(0)

    X = df[columnas_texto + columnas_numericas]
    y = df["precio_usd"].fillna(df["precio_usd"].median())

    preprocesador = ColumnTransformer(
        transformers=[
            ("texto", OneHotEncoder(handle_unknown="ignore"), columnas_texto),
            ("numeros", "passthrough", columnas_numericas)
        ]
    )

    nuevo_modelo = Pipeline(steps=[
        ("preprocesador", preprocesador),
        ("modelo", RandomForestRegressor(n_estimators=100, random_state=42))
    ])

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    nuevo_modelo.fit(X_train, y_train)
    
    modelo_v4 = nuevo_modelo
    print("✅ ¡Modelo entrenado con éxito con los datos actuales de Neon!")

try:
    entrenar_modelo()
except Exception as e:
    print(f"⚠️ Error al entrenar el modelo inicial: {e}")

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

@app.post("/estimar-precio")
def estimar_precio(propiedad: PropiedadInput):
    # Coordenadas por defecto (Obelisco, Buenos Aires)
    latitud = -34.6037
    longitud = -58.3816

    if modelo_v4 is None:
        return {
            "status": "warning",
            "coordenadas": {"lat": latitud, "lng": longitud},
            "precio_estimado_usd": 450.0, 
            "message": "Modelo en fase de acumulación de datos inicial."
        }

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
        "longitud": [longitud]
    }
    
    df_input = pd.DataFrame(datos_entrada)
    df_input = df_input[columnas_texto + columnas_numericas]
    
    precio_predicho = modelo_v4.predict(df_input)[0]
    
    return {
        "status": "success",
        "coordenadas": {"lat": latitud, "lng": longitud},
        "precio_estimado_usd": float(precio_predicho)
    }

@app.post("/reentrenar")
def reentrenar_api():
    try:
        entrenar_modelo()
        return {"status": "success", "message": "Modelo re-entrenado exitosamente."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("API IA:app", host="127.0.0.1", port=8000, reload=True)