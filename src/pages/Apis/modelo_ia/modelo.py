"""Carga y limpieza del CSV, entrenamiento de CatBoost y evaluación."""

import math
import re
import os
from pathlib import Path
import unicodedata
from collections import Counter
from urllib.parse import urlsplit
import json
import hashlib
import pandas as pd
from catboost import CatBoostRegressor
import numpy as np
from sklearn.base import clone
from sklearn.metrics import mean_absolute_error, mean_squared_error, mean_absolute_percentage_error, r2_score
from sklearn.model_selection import KFold, train_test_split, GroupShuffleSplit, GroupKFold
from sklearn.compose import TransformedTargetRegressor


DATASET_CSV = Path(__file__).resolve().parent / "dataset" / "propiedades.csv"
REVISION_REPUBLICACIONES = DATASET_CSV.parent / "revision_republicaciones.json"
COLUMNAS_BOOLEANAS = (
    "cochera", "balcon", "terraza", "patio", "pileta", "parrilla", "ascensor",
    "baulera", "sum", "gym", "lounge", "laundry", "seguridad_24hs", "camara",
)


def cargar_dataset_csv(ruta=None):
    """Lee el CSV sin modificarlo; usa el precio publicado como objetivo.

    Prioridad: ruta recibida, MODELO_DATASET_CSV, CSV local.
    """
    ruta = Path(ruta or os.environ.get("MODELO_DATASET_CSV") or DATASET_CSV).expanduser()
    df = pd.read_csv(ruta, encoding="utf-8-sig", dtype=str, keep_default_na=False)
    requeridas = {"id_propiedad", "url", "tipo_operacion", "tipo_propiedad", "barrio_zona",
                  "precio_real_usd", "superficie_total_m2", "superficie_cubierta_m2"}
    faltan = requeridas - set(df.columns)
    if faltan:
        raise ValueError("Faltan columnas requeridas en el CSV: " + ", ".join(sorted(faltan)))
    # Vacíos y NULL quedan como datos desconocidos.
    for col in df.columns:
        df[col] = df[col].str.strip().map(lambda v: None if v in ("", "NULL", "null", "\\N") else v)
    for col in COLUMNAS_BOOLEANAS:
        if col not in df:
            df[col] = None
            continue
        mapeo = {"true": 1.0, "t": 1.0, "1": 1.0, "false": 0.0, "f": 0.0, "0": 0.0}
        valores = df[col].map(lambda v: v.casefold() if v is not None else None)
        invalidos = valores.notna() & ~valores.isin(mapeo)
        if invalidos.any():
            raise ValueError(f"El CSV contiene {int(invalidos.sum())} booleanos no reconocidos en {col}.")
        df[col] = valores.map(mapeo)
    for col in COLUMNAS_NUMERICAS:
        if col not in COLUMNAS_BOOLEANAS:
            df[col] = pd.to_numeric(df[col], errors="coerce") if col in df else float("nan")
    df["precio_usd"] = pd.to_numeric(df["precio_real_usd"], errors="coerce")
    return df


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
    # Confirma venta por operación o URL. «Compra» sola no alcanza.
    operacion = normalizar_texto(registro.get("tipo_operacion"))
    ruta = urlsplit(str(registro.get("url") or "")).path.casefold()
    if operacion == "alquiler" or "alquiler" in ruta or "/clasificado/al" in ruta:
        return False
    return operacion == "venta" or "venta" in ruta or "/clasificado/ve" in ruta


def limpiar_registros(registros):
    """Devuelve registros válidos y cuenta descartes por motivo.

    La moneda depende de lo informado por la fuente.
    """
    motivos = Counter()
    ajustes = Counter()
    vistos = set()
    limpios = []
    for original in registros:
        fila = dict(original)
        motivo = None
        precio = numero(fila.get("precio_usd"))
        total = numero(fila.get("superficie_total_m2"))
        cubierta = numero(fila.get("superficie_cubierta_m2"))
        ruta = urlsplit(str(fila.get("url") or "")).path.casefold()
        # El modelo tasa viviendas individuales.
        if "/emprendimiento/" in ruta:
            motivo = "emprendimiento_sin_unidad_individual"
        elif (str(fila.get('id_propiedad')) == 'zp-60396281'
              and ruta == '/propiedades/clasificado/veclcain-imponente-casa-con-el-mejor-jardin-de-belgrano-r-60396281.html'):
            # Dos casas linderas verificadas el 28/10/2026; evidencia en el ZIP.
            motivo = 'dos_casas_linderas_fuera_de_alcance'
        elif str(fila.get("id_propiedad")) in {"zp-58786232", "zp-59958267"} or re.search(r"(?:^|[-/])en-(?:block|bloque)(?:[-./]|$)", ruta):
            motivo = "venta_en_bloque_fuera_de_alcance"
        elif str(fila.get("id_propiedad")) == "zp-56957710":
            motivo = "superficie_contradictoria_verificada"
        elif normalizar_texto(fila.get("fuente_precio")) == "ia":
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
            # Baños puede superar ambientes; se descarta si baños >= m² totales.
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
            # El código de la URL identifica el tipo del anuncio.
            for codigo, tipo in (("veclapin", "Departamento"), ("veclcain", "Casa"), ("veclphin", "PH")):
                if f"/clasificado/{codigo}-" in ruta:
                    if normalizar_texto(fila.get("tipo_propiedad")) != normalizar_texto(tipo):
                        ajustes["tipo_corregido_por_categoria_del_anuncio"] += 1
                    fila["tipo_propiedad"] = tipo
                    break
            limpios.append(fila)
    limpios, republicaciones = eliminar_republicaciones(limpios)
    if republicaciones:
        motivos["republicacion_verificada"] += len(republicaciones)
    return limpios, {"entrada": len(registros), "aceptados": len(limpios), "descartados_por_motivo": dict(motivos), "ajustes": dict(ajustes),
                     "republicaciones_eliminadas": republicaciones}


def firma_republicacion(fila):
    """Firma para buscar posibles copias; requiere revisión antes de eliminar.

    Usa título, dirección y estructura; conserva UF y piso. No usa precios ni el barrio declarado.
    """
    url = urlsplit(str(fila.get("url") or ""))
    if (url.hostname or "").casefold() not in {"www.zonaprop.com.ar", "zonaprop.com.ar"}:
        return None
    anuncio = re.fullmatch(r"/propiedades/clasificado/(veclapin|veclcain|veclphin)-(.+)-([0-9]+)\.html", url.path.casefold())
    direccion_completa = normalizar_texto(fila.get("direccion"))
    direccion = re.sub(r"\bal\b", "", direccion_completa.split(",")[0])
    direccion = " ".join(re.sub(r"[^a-z0-9]+", " ", direccion).split())
    unidades = re.findall(r"\b(uf|unidad(?: funcional)?|piso|dpto|depto|departamento)\s*[:#-]?\s*([a-z0-9]+)\b", direccion_completa)
    campos = ("superficie_total_m2", "superficie_cubierta_m2", "ambientes", "dormitorios", "banos", "piso")
    valores = [numero(fila.get(c)) for c in campos]
    if not anuncio or not re.search(r"\b[1-9][0-9]{1,4}\b", direccion) or not re.search(r"[a-z]{3}", direccion):
        return None
    if any(v is None or v <= 0 for v in valores[:3]):
        return None
    return [anuncio[2], direccion, [list(u) for u in unidades], *valores]


def detectar_republicaciones(registros):
    """Agrupa candidatos de firma idéntica para revisar."""
    grupos = {}
    for fila in registros:
        firma = firma_republicacion(fila)
        if firma is not None:
            grupos.setdefault(json.dumps(firma, ensure_ascii=False), []).append(fila)
    return [miembros for miembros in grupos.values() if len(miembros) > 1]


def leer_revision_republicaciones():
    return json.loads(REVISION_REPUBLICACIONES.read_text(encoding="utf-8"))


def huella_identidad_republicacion(fila):
    """Huella del anuncio para detectar cambios desde su revisión."""
    url = urlsplit(str(fila.get("url") or ""))
    tipo = normalizar_texto(fila.get("tipo_propiedad"))
    for codigo, categoria in (("veclapin", "Departamento"), ("veclcain", "Casa"), ("veclphin", "PH")):
        if f"/clasificado/{codigo}-" in url.path.casefold():
            tipo = normalizar_texto(categoria)
    gps = [numero(v) for v in _extraer_coordenadas(fila)]
    identidad = [str(fila.get("id_propiedad")), (url.hostname or "").casefold(), url.path,
                 normalizar_texto(fila.get("direccion")), tipo,
                 normalizar_texto(fila.get("barrio_zona")), gps, firma_republicacion(fila)]
    return hashlib.sha256(json.dumps(identidad, ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def eliminar_republicaciones(registros, revision=None):
    """Elimina copias verificadas si su identidad sigue coincidiendo.

    Prioriza fecha publicada, completitud y menor ID, sin combinar datos.
    La fecha del CSV no confirma la última actualización del aviso.
    """
    if len(registros) < 2:
        return list(registros), []
    revision = leer_revision_republicaciones() if revision is None else revision
    eliminadas = {}
    revisados = set()
    for caso in revision.get("casos", []):
        if caso["decision"] != "mismo_inmueble":
            continue
        if revisados.intersection(caso["ids"]):
            raise ValueError("La revisión contiene grupos confirmados solapados; unificar su identidad antes de eliminar.")
        revisados.update(caso["ids"])
        miembros = [f for f in registros if str(f.get("id_propiedad")) in caso["ids"]
                    and firma_republicacion(f) == caso["firma"]
                    and huella_identidad_republicacion(f) == caso["huellas"].get(str(f.get("id_propiedad")))]
        if len(miembros) < 2:
            continue
        def orden(fila):
            fecha = pd.to_datetime(fila.get("fecha_publicacion"), errors="coerce", utc=True)
            fecha = fecha.date().toordinal() if pd.notna(fecha) else 0
            # La completitud cuenta características, no precio ni error.
            completitud = sum(normalizar_texto(fila.get(c)) != "no especificada"
                              for c in COLUMNAS_TEXTO + COLUMNAS_NUMERICAS)
            return (-fecha, -completitud, str(fila.get("id_propiedad")))
        conservada = min(miembros, key=orden)
        for fila in miembros:
            if fila is conservada:
                continue
            identificador = str(fila["id_propiedad"])
            eliminadas[identificador] = {
                "id_eliminado": identificador, "id_conservado": str(conservada["id_propiedad"]),
                "fecha_eliminado": fila.get("fecha_publicacion"), "fecha_conservado": conservada.get("fecha_publicacion"),
                "url_eliminado": fila.get("url"), "url_conservado": conservada.get("url"),
                "precio_eliminado_usd": numero(fila.get("precio_usd", fila.get("precio_real_usd"))),
                "precio_conservado_usd": numero(conservada.get("precio_usd", conservada.get("precio_real_usd"))),
                "motivo": "republicacion_verificada", "evidencia": caso["evidencia"],
            }
    return [f for f in registros if str(f.get("id_propiedad")) not in eliminadas], list(eliminadas.values())


# Preparación y CatBoost

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
        df[col] = pd.to_numeric(df[col], errors="coerce").replace([float("inf"), -float("inf")], float("nan")).astype(float)

    return df


CONFIGURACION_MODELO = Path(__file__).resolve().parent / "configuracion_catboost.json"


def leer_configuracion():
    return json.loads(CONFIGURACION_MODELO.read_text())


def crear_modelo(configuracion=None):
    """Objetivo directo o logarítmico; predict siempre devuelve dólares."""
    configuracion = configuracion or leer_configuracion()
    modelo = CatBoostRegressor(**configuracion["parametros"], cat_features=tuple(COLUMNAS_TEXTO),
                              nan_mode="Min", random_seed=42, thread_count=4,
                              verbose=False, allow_writing_files=False)
    if configuracion["transformacion_objetivo"] == "log":
        return TransformedTargetRegressor(regressor=modelo, func=np.log, inverse_func=np.exp, check_inverse=False)
    if configuracion["transformacion_objetivo"] != "directo":
        raise ValueError("Transformación del objetivo desconocida")
    return modelo


def catboost_ajustado(modelo):
    return modelo.regressor_ if isinstance(modelo, TransformedTargetRegressor) else modelo


def agrupar_inmuebles(df):
    """Agrupa por dirección y tipo, o por GPS, cubierta, ambientes y tipo.

    Sin usar precios ni eliminar filas. Puede reunir viviendas distintas;
    sirve para separar conjuntos, no para confirmar republicaciones.
    """
    padres = list(range(len(df)))
    def raiz(i):
        while padres[i] != i:
            padres[i] = padres[padres[i]]
            i = padres[i]
        return i
    vistos = {}
    for i, fila in enumerate(df.to_dict("records")):
        tipo = normalizar_texto(fila.get("tipo_propiedad"))
        direccion = normalizar_texto(fila.get("direccion")).split(",")[0]
        direccion = re.sub(r"\bal\b", "", direccion)
        direccion = re.sub(r"[^a-z0-9 ]", " ", direccion)
        direccion = " ".join(direccion.split())
        claves = []
        if re.search(r"[1-9][0-9]{1,4}", direccion) and re.search(r"[a-z]{3}", direccion):
            claves.append(("direccion", tipo, direccion))
        lat, lng = _extraer_coordenadas(fila)
        cubierta, ambientes = numero(fila.get("superficie_cubierta_m2")), numero(fila.get("ambientes"))
        if pd.notna(lat) and pd.notna(lng) and (round(lat,4),round(lng,4)) != (-34.6037,-58.3816) and cubierta is not None and ambientes is not None:
            claves.append(("gps",tipo,round(lat,4),round(lng,4),round(cubierta,1),ambientes))
        for clave in claves:
            if clave in vistos:
                padres[raiz(i)] = raiz(vistos[clave])
            else:
                vistos[clave] = i
    # El menor ID identifica al grupo de forma reproducible.
    componentes = {}
    for i, fila in enumerate(df.to_dict("records")):
        componentes.setdefault(raiz(i), []).append(str(fila.get("id_propiedad") or i))
    return np.array([min(componentes[raiz(i)]) for i in range(len(df))])


def dividir_datos(n, grupos=None, random_state=20261028):
    indices = np.arange(n)
    if grupos is None:
        return train_test_split(indices, test_size=.2, random_state=random_state)
    return next(GroupShuffleSplit(n_splits=1, test_size=.2, random_state=random_state).split(indices, groups=grupos))


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


RANGOS_PRECIO = (
    ('hasta_100k',0,100000),('100k_250k',100000,250000),
    ('250k_500k',250000,500000),('500k_1m',500000,1000000),('mas_1m',1000000,float('inf')),
)


def evaluar_segmentos(X,y,predicciones,train,test,*,grupos=None):
    """Evalúa predicciones por tipo, barrio y precio observado.

    El precio define rangos después de predecir. Con menos de cinco casos,
    omite métricas; con menos de 30 grupos, marca muestra pequeña.
    """
    y,pred = np.asarray(y,dtype=float),np.asarray(predicciones,dtype=float)
    train,test = np.asarray(train,dtype=int),np.asarray(test,dtype=int)
    if (y.shape != (len(X),) or pred.shape != (len(test),) or not np.isfinite(y).all()
            or (y<=0).any() or not np.isfinite(pred).all()):
        raise ValueError('Etiquetas positivas y predicciones finitas alineadas con las filas de prueba son necesarias.')
    if (len(set(train))!=len(train) or len(set(test))!=len(test) or set(train)&set(test)
            or any(i<0 or i>=len(X) for i in np.r_[train,test])):
        raise ValueError('Entrenamiento y prueba deben contener posiciones únicas, válidas y separadas.')
    if grupos is not None:
        grupos = np.asarray(grupos)
        if len(grupos)!=len(X) or set(grupos[train])&set(grupos[test]):
            raise ValueError('Los grupos deben estar alineados y separados entre entrenamiento y prueba.')
    rangos = np.full(len(X),'',dtype=object)
    for nombre,bajo,alto in RANGOS_PRECIO:
        rangos[(y>bajo)&(y<=alto)] = nombre
    etiquetas = {}
    for campo,dimension in [('tipo_propiedad','por_tipo'),('barrio_zona','por_barrio')]:
        if campo in X:
            etiquetas[dimension] = X[campo].map(normalizar_texto).to_numpy()
    etiquetas['por_precio'] = rangos

    def resumir(mascara):
        mascara_train,mascara_test = mascara[train],mascara[test]
        n_train,n_test = int(mascara_train.sum()),int(mascara_test.sum())
        n_grupos_train = len(set(grupos[train][mascara_train])) if grupos is not None else None
        n_grupos_test = len(set(grupos[test][mascara_test])) if grupos is not None else None
        avisos = []
        if n_train==0:
            avisos.append('Sin ejemplos de entrenamiento.')
        if n_test==0:
            avisos.append('Sin prueba; precisión sin evaluar.')
        elif n_test<5:
            avisos.append('Menos de 5 publicaciones de prueba: sin métricas.')
        pocos = (n_grupos_test if n_grupos_test is not None else n_test)<30
        if n_test and pocos:
            avisos.append('Menos de 30 grupos (o filas sin grupos): muestra pequeña.')
        resultado = {'n_entrenamiento':n_train,'n_prueba':n_test,
                     'grupos_entrenamiento':n_grupos_train,'grupos_prueba':n_grupos_test,
                     'porcentaje_de_la_prueba':float(n_test/max(1,len(test))*100),
                     'muestra_pequena':pocos,'advertencias':avisos,'metricas':None}
        if n_test>=5:
            reales,estimados = y[test][mascara_test],pred[mascara_test]
            resultado['metricas'] = calcular_metricas(reales,estimados)
            error = (estimados-reales)/reales*100
            resultado['metricas']['sesgo_porcentual_medio'] = float(error.mean())
            resultado['metricas']['sesgo_porcentual_mediano'] = float(np.median(error))
            resultado['metricas']['dentro_del_error_porcentual'] = {
                f'hasta_{limite}':float(np.mean(np.abs(error)<=limite+1e-12)*100) for limite in (10,20,30)}
        return resultado

    informe = {'n_entrenamiento':len(train),'n_prueba':len(test),
               'minimo_publicaciones_para_metricas':5,'umbral_alerta_grupos_pequenos':30,
               'metricas_globales':calcular_metricas(y[test],pred) if len(test)>=2 else None,
               'notas':['Diagnóstico del test; no selecciona modelos ni parámetros.',
                        'Los umbrales de 5 filas y 30 grupos no garantizan estabilidad.',
                        'Los rangos usan el precio observado, desconocido al tasar.',
                        'Se mantienen los barrios del modelo, incluidos alias y subzonas.',
                        'Un grupo puede aparecer en varios segmentos; no sumar sus conteos.',
                        'R² puede ser negativo; no es porcentaje de aciertos.']}
    for dimension,valores in etiquetas.items():
        nombres = [r[0] for r in RANGOS_PRECIO] if dimension=='por_precio' else sorted(set(valores))
        informe[dimension] = {str(nombre):resumir(valores==nombre) for nombre in nombres}
    for barrio,resultado in informe.get('por_barrio',{}).items():
        if barrio in ('no especificada','capital federal','caba','ciudad autonoma de buenos aires') or barrio.startswith(('entre ','e/ ')):
            resultado['advertencias'].append('Ubicación ausente, genérica o con formato de dirección; revisar fuente.')
    if 'por_tipo' in etiquetas:
        informe['por_tipo_y_precio'] = {
            tipo:{nombre:resumir((etiquetas['por_tipo']==tipo)&(rangos==nombre)) for nombre,_,_ in RANGOS_PRECIO}
            for tipo in sorted(set(etiquetas['por_tipo']))}
    return informe


def evaluar_modelo(modelo, X, y, *, random_state=42, grupos=None):
    """Reserva el 20% de filas o grupos para prueba; hace cinco folds en el resto.

    Respeta grupos si se indican. Cada fold entrena un clon independiente;
    el modelo final usa solo desarrollo. No busca hiperparámetros.
    """
    if len(X) < 20:
        raise ValueError('Evaluación de 5 folds requiere al menos 20 registros; no es un umbral de suficiencia estadística.')
    train, test = dividir_datos(len(X), grupos, random_state)
    y = pd.Series(np.asarray(y, dtype=float))
    X_train, y_train = X.iloc[train], y.iloc[train]
    folds = []
    if grupos is None:
        particiones = KFold(n_splits=5, shuffle=True, random_state=random_state).split(X_train)
    else:
        grupos = np.asarray(grupos)
        if len(set(grupos[train])) < 5:
            raise ValueError("Se necesitan al menos cinco grupos de entrenamiento")
        particiones = GroupKFold(n_splits=5, shuffle=True, random_state=random_state).split(X_train, groups=grupos[train])
    for numero, (a, b) in enumerate(particiones, 1):
        candidato = clone(modelo)
        candidato.fit(X_train.iloc[a], y_train.iloc[a])
        folds.append({'fold': numero, **calcular_metricas(y_train.iloc[b], candidato.predict(X_train.iloc[b]))})
    ajustado = clone(modelo).fit(X_train, y_train)
    pred = ajustado.predict(X.iloc[test])
    referencia = np.full(len(test), np.median(y_train))
    informe = {
        'metodo': 'Prueba por grupos; CV GroupKFold (5 folds) en desarrollo' if grupos is not None else 'Prueba aleatoria 80/20; CV KFold (5 folds)',
        'random_state': random_state, 'n_entrenamiento': len(train), 'n_prueba': len(test),
        'prueba': calcular_metricas(y.iloc[test], pred),
        'referencia_mediana_prueba': calcular_metricas(y.iloc[test], referencia),
        'cross_validation': {
            'folds': folds,
            'resumen': {k: {'media': float(np.mean(v)), 'desvio_estandar': float(np.std(v, ddof=1))} for k in ('mae_usd', 'rmse_usd', 'mape_porcentaje', 'r2') if (v := [f[k] for f in folds if f[k] is not None])},
        },
        'limitaciones': [
            'La partición aleatoria no valida fechas ni zonas nuevas.',
            'Sin grupos, puede haber republicaciones en ambos conjuntos.',
            'Precios publicados; sin verificar moneda ni ventas cerradas.',
            'El promedio no asegura precisión en tipos con pocos datos.',
            'Los percentiles no son intervalos de precio individual.',
        ],
    }
    if grupos is not None:
        informe['grupos'] = {'total': len(set(grupos)), 'entrenamiento': len(set(grupos[train])),
                             'prueba': len(set(grupos[test])), 'compartidos': len(set(grupos[train]) & set(grupos[test]))}
        informe['limitaciones'][1] = 'Grupos aproximados por dirección/GPS; no detectan todas las copias.'
        informe['limitaciones'].append('Este CSV ya se exploró; falta validar con datos futuros.')
    informe['evaluacion_segmentos'] = evaluar_segmentos(X,y,pred,train,test,grupos=grupos)
    detalle = pd.DataFrame({'indice_fila': test, 'precio_observado_usd': y.iloc[test].to_numpy(), 'precio_predicho_usd': pred})
    detalle['error_absoluto_usd'] = abs(detalle.precio_observado_usd - detalle.precio_predicho_usd)
    detalle['error_porcentual'] = detalle.error_absoluto_usd / detalle.precio_observado_usd * 100
    return ajustado, informe, detalle
