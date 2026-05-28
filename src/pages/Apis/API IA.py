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

X = df[[
    "tipo_propiedad",
    "barrio_zona",
    "ambientes",
    "dormitorios",
    "banos",
    "superficie_total_m2",
    "superficie_cubierta_m2",
    "estado",
    "anios_de_antiguedad",
    "cochera",
    "balcon",
    "terraza",
    "patio",
    "pileta",
    "parrilla",
    "seguridad_24hs",
    "ascensor",
    "expensas_ars",
    "latitud",
    "longitud"
]]

y = df["precio_usd"]

columnas_texto = [
    "tipo_propiedad",
    "barrio_zona",
    "estado"
]

columnas_numericas = [
    "ambientes",
    "dormitorios",
    "banos",
    "superficie_total_m2",
    "superficie_cubierta_m2",
    "anios_de_antiguedad",
    "cochera",
    "balcon",
    "terraza",
    "patio",
    "pileta",
    "parrilla",
    "seguridad_24hs",
    "ascensor",
    "expensas_ars",
    "latitud",
    "longitud"
]

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
mae = mean_absolute_error(y_test, predicciones)
r2 = r2_score(y_test, predicciones)

print("Error promedio en USD:", mae)
print("R2:", r2)

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
    cochera: bool
    balcon: bool
    terraza: bool
    patio: bool
    pileta: bool
    parrilla: bool
    seguridad_24hs: bool
    ascensor: bool
    expensas_ars: int

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
        "ambientes": [propiedad.ambientes],
        "dormitorios": [propiedad.dormitorios],
        "banos": [propiedad.banos],
        "superficie_total_m2": [propiedad.superficie_total_m2],
        "superficie_cubierta_m2": [propiedad.superficie_cubierta_m2],
        "estado": [propiedad.estado],
        "anios_de_antiguedad": [propiedad.anios_de_antiguedad],
        "cochera": [int(propiedad.cochera)],
        "balcon": [int(propiedad.balcon)],
        "terraza": [int(propiedad.terraza)],
        "patio": [int(propiedad.patio)],
        "pileta": [int(propiedad.pileta)],
        "parrilla": [int(propiedad.parrilla)],
        "seguridad_24hs": [int(propiedad.seguridad_24hs)],
        "ascensor": [int(propiedad.ascensor)],
        "expensas_ars": [propiedad.expensas_ars],
        "latitud": [latitud],
        "longitud": [longitud]
    }
    
    df_input = pd.DataFrame(datos_entrada)
    precio_predicho = modelo_v4.predict(df_input)[0]
    
    return {
        "status": "success",
        "coordenadas": {"lat": latitud, "lng": longitud},
        "precio_estimado_usd": float(precio_predicho)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)