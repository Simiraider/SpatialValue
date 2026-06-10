from fastapi import FastAPI
from pydantic import BaseModel
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
from sklearn.pipeline import Pipeline
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from geopy.geocoders import Nominatim

app = FastAPI(title="API IA Estimador")
geolocator = Nominatim(user_agent="estimador_propiedades_craigslist_bot")

df = pd.read_csv("dataset_propiedades_200_completo (1).csv")

if "latitud" not in df.columns or "longitud" not in df.columns:
    df["latitud"] = -34.6037
    df["longitud"] = -58.3816

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
for col in columnas_texto:
    if col not in df.columns:
        df[col] = "No especificada"
    df[col] = df[col].fillna("No especificada")

for col in columnas_numericas:
    if col not in df.columns:
        df[col] = 0
    df[col] = df[col].fillna(0)

X = df[columnas_texto + columnas_numericas]
y = df["precio_usd"]

preprocesador = ColumnTransformer(
    transformers=[
        ("texto", OneHotEncoder(handle_unknown="ignore"), columnas_texto),
        ("numeros", "passthrough", columnas_numericas)
    ]
)

modelo_v4 = Pipeline(steps=[
    ("preprocesador", preprocesador),
    ("modelo", RandomForestRegressor(n_estimators=100, random_state=42))
])

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
modelo_v4.fit(X_train, y_train)

predicciones = modelo_v4.predict(X_test)
print("Error promedio en USD:", mean_absolute_error(y_test, predicciones))
print("R2 Score:", r2_score(y_test, predicciones))

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
    direccion_busqueda = f"{propiedad.barrio_zona}, Buenos Aires, Argentina"
    latitud = None
    longitud = None
    
    try:
        location = geolocator.geocode(direccion_busqueda, timeout=10)
        if location:
            latitud = location.latitude
            longitud = location.longitude
    except:
        pass
    
    if latitud is None or longitud is None:
        latitud = -34.6037
        longitud = -58.3816

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)