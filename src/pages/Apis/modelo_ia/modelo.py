"""Consulta, limpieza, Random Forest y evaluación. Importar no abre conexiones ni entrena."""

import math
import unicodedata
from collections import Counter
from urllib.parse import urlsplit
import json
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
import numpy as np
from sklearn.base import clone
from sklearn.dummy import DummyRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, mean_absolute_percentage_error, r2_score
from sklearn.model_selection import KFold, train_test_split


# Consulta de entrenamiento

CONSULTA_ENTRENAMIENTO = """
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


# Limpieza de registros

def normalizar_texto(valor):
    if valor is None or (isinstance(valor, float) and math.isnan(valor)):
        return "no especificada"
    texto = unicodedata.normalize("NFKD", str(valor))
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return " ".join(texto.casefold().split()) or "no especificada"


def numero(valor):
    try:
        resultado = float(valor)
        return resultado if math.isfinite(resultado) else None
    except (TypeError, ValueError, OverflowError):
        return None


def es_venta(registro):
    # La consulta actual no dispone de una columna de operación: se usa la URL.
    # Solo aceptamos una señal explícita; el precio nunca determina la operación.
    operacion = normalizar_texto(registro.get("tipo_operacion"))
    ruta = urlsplit(str(registro.get("url") or "")).path.casefold()
    if operacion == "alquiler" or "alquiler" in ruta or "/clasificado/al" in ruta:
        return False
    return operacion == "venta" or "venta" in ruta or "/clasificado/ve" in ruta


def limpiar_registros(registros):
    """Devuelve copias válidas e informe con el primer motivo de descarte por fila.

    precio_usd sigue dependiendo del contrato de la fuente: esta función no puede
    certificar que el scraper haya interpretado correctamente la moneda original.
    """
    motivos = Counter()
    vistos = set()
    limpios = []
    for original in registros:
        fila = dict(original)
        motivo = None
        precio = numero(fila.get("precio_usd"))
        total = numero(fila.get("superficie_total_m2"))
        cubierta = numero(fila.get("superficie_cubierta_m2"))
        if normalizar_texto(fila.get("fuente_precio")) == "ia":
            motivo = "precio_generado_por_ia"
        elif not es_venta(fila):
            motivo = "operacion_no_confirmada_como_venta"
        elif precio is None or precio <= 0:
            motivo = "precio_invalido"
        elif total is None or cubierta is None or total <= 0 or cubierta <= 0 or cubierta > total:
            motivo = "superficies_invalidas"
        else:
            fila.update(precio_usd=precio, superficie_total_m2=total, superficie_cubierta_m2=cubierta)
            for campo in ("ambientes", "dormitorios", "banos", "anios_de_antiguedad", "expensas_ars", "piso"):
                fila[campo] = numero(fila.get(campo))
            for campo in ("ambientes", "dormitorios", "banos", "anios_de_antiguedad", "expensas_ars"):
                valor = fila[campo]
                if valor is not None and (valor < 0 or (campo == "ambientes" and valor == 0)):
                    motivo = "caracteristicas_invalidas"
            ambientes, dormitorios = fila["ambientes"], fila["dormitorios"]
            if ambientes is not None and dormitorios is not None and dormitorios > ambientes:
                motivo = "dormitorios_mayores_que_ambientes"
            # No imponemos baños <= ambientes: puede ser legítimo. Un baño por
            # cada menos de 1 m² sí constituye una inconsistencia evidente.
            if fila["banos"] is not None and fila["banos"] >= total:
                motivo = "banos_incompatibles_con_superficie"
        identificador = fila.get("id_propiedad")
        if motivo is None and identificador is not None:
            clave = str(identificador).strip()
            if clave and clave in vistos:
                motivo = "id_duplicado"
            elif clave:
                vistos.add(clave)
        if motivo:
            motivos[motivo] += 1
        else:
            limpios.append(fila)
    return limpios, {"entrada": len(registros), "aceptados": len(limpios), "descartados_por_motivo": dict(motivos)}


# Preparación y Random Forest

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


def crear_modelo():
    preprocesador = ColumnTransformer(
        transformers=[
            ("texto", OneHotEncoder(handle_unknown="ignore"), COLUMNAS_TEXTO),
            ("numeros", SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True), COLUMNAS_NUMERICAS),
        ]
    )

    return Pipeline(
        steps=[
            ("preprocesador", preprocesador),
            ("modelo", RandomForestRegressor(n_estimators=100, random_state=42)),
        ]
    )


# Evaluación y métricas

def calcular_metricas(reales, predichos):
    reales, predichos = np.asarray(reales, dtype=float), np.asarray(predichos, dtype=float)
    if reales.ndim != 1 or reales.shape != predichos.shape or len(reales) < 2:
        raise ValueError('Se necesitan al menos dos pares de observaciones y predicciones.')
    if not np.isfinite(reales).all() or not np.isfinite(predichos).all() or (reales <= 0).any():
        raise ValueError('Los precios reales deben ser positivos y todos los valores finitos.')
    absoluto = np.abs(reales - predichos)
    relativo = absoluto / reales * 100
    r2 = float(r2_score(reales, predichos)) if np.var(reales) > 0 else None
    return {
        'n': len(reales),
        'mae_usd': float(mean_absolute_error(reales, predichos)),
        'rmse_usd': float(np.sqrt(mean_squared_error(reales, predichos))),
        'mape_porcentaje': float(mean_absolute_percentage_error(reales, predichos) * 100),
        'r2': r2,
        'percentiles_error_absoluto_usd': {f'p{p}': float(np.percentile(absoluto, p)) for p in (50, 75, 90, 95, 99, 100)},
        'percentiles_error_porcentual': {f'p{p}': float(np.percentile(relativo, p)) for p in (50, 75, 90, 95, 99, 100)},
    }


def evaluar_modelo(modelo, X, y, *, random_state=42):
    """Devuelve el modelo ajustado SOLO en el 80%, informe y predicciones holdout.

    Las cinco particiones de CV usan exclusivamente ese 80%. Cada clon vuelve a
    aprender encoder e imputación. El 20% final no participa en CV ni selección.
    No se ajustan hiperparámetros ni se eliminan extremos en función de su precio.
    """
    if len(X) < 20:
        raise ValueError('Evaluación de 5 folds requiere al menos 20 registros; no es un umbral de suficiencia estadística.')
    indices = np.arange(len(X))
    train, test = train_test_split(indices, test_size=.2, random_state=random_state)
    y = pd.Series(np.asarray(y, dtype=float))
    X_train, y_train = X.iloc[train], y.iloc[train]
    folds = []
    for numero, (a, b) in enumerate(KFold(n_splits=5, shuffle=True, random_state=random_state).split(X_train), 1):
        candidato = clone(modelo)
        candidato.fit(X_train.iloc[a], y_train.iloc[a])
        folds.append({'fold': numero, **calcular_metricas(y_train.iloc[b], candidato.predict(X_train.iloc[b]))})
    ajustado = clone(modelo).fit(X_train, y_train)
    pred = ajustado.predict(X.iloc[test])
    baseline = DummyRegressor(strategy='median').fit(np.zeros((len(train), 1)), y_train)
    referencia = baseline.predict(np.zeros((len(test), 1)))
    informe = {
        'metodo': 'holdout aleatorio 80/20; CV KFold 5 particiones solo sobre el 80% de entrenamiento',
        'random_state': random_state, 'n_entrenamiento': len(train), 'n_prueba': len(test),
        'prueba': calcular_metricas(y.iloc[test], pred),
        'referencia_mediana_prueba': calcular_metricas(y.iloc[test], referencia),
        'cross_validation': {
            'folds': folds,
            'resumen': {k: {'media': float(np.mean(v)), 'desvio_estandar': float(np.std(v, ddof=1))} for k in ('mae_usd', 'rmse_usd', 'mape_porcentaje', 'r2') if (v := [f[k] for f in folds if f[k] is not None])},
        },
        'limitaciones': [
            'Partición aleatoria: no mide generalización temporal ni geográfica.',
            'Sin agrupación por inmueble: republicaciones podrían compartir información entre particiones.',
            'Precios publicados según la fuente, no ventas cerradas ni moneda verificada.',
            'El desempeño agregado no garantiza precisión en tipos con pocos ejemplos.',
            'Percentiles de errores observados no son intervalos de confianza individuales.',
        ],
    }
    for campo in ('tipo_propiedad', 'barrio_zona'):
        if campo in X:
            informe[f'cobertura_{campo}'] = {nombre: X.iloc[idx][campo].value_counts().to_dict() for nombre, idx in [('entrenamiento', train), ('prueba', test)]}
    if 'tipo_propiedad' in X:
        tipos = X.iloc[test].tipo_propiedad.to_numpy()
        informe['prueba_por_tipo'] = {}
        for tipo in sorted(set(tipos)):
            mascara = tipos == tipo
            n = int(mascara.sum())
            informe['prueba_por_tipo'][tipo] = {
                'n': n,
                'advertencia': 'Muy pocos ejemplos; no demuestra precisión para este segmento.' if n < 30 else None,
                'metricas': calcular_metricas(y.iloc[test].to_numpy()[mascara], pred[mascara]) if n >= 2 else None,
            }
    detalle = pd.DataFrame({'indice_fila': test, 'precio_observado_usd': y.iloc[test].to_numpy(), 'precio_predicho_usd': pred})
    detalle['error_absoluto_usd'] = abs(detalle.precio_observado_usd - detalle.precio_predicho_usd)
    detalle['error_porcentual'] = detalle.error_absoluto_usd / detalle.precio_observado_usd * 100
    return ajustado, informe, detalle
