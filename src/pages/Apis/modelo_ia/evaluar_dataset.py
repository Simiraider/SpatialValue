"""Evaluación del CatBoost vigente sin importar FastAPI ni Neon.

PYTHONPATH=src/pages/Apis python -m modelo_ia.evaluar_dataset
Agregar --solo-informe para regenerar el documento sin entrenar.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import numpy as np
import pandas as pd
from catboost import Pool
from sklearn.compose import TransformedTargetRegressor
from sklearn.inspection import permutation_importance
from sklearn.model_selection import GroupShuffleSplit
from .modelo import (DATASET_CSV, COLUMNAS_TEXTO, COLUMNAS_NUMERICAS,
                     cargar_dataset_csv, limpiar_registros, _preparar_features,
                     agrupar_inmuebles, dividir_datos, crear_modelo, leer_configuracion,
                     evaluar_modelo, calcular_metricas, catboost_ajustado)

RAIZ = Path(__file__).resolve().parent
SALIDA = RAIZ/'auditoria'/'actual'


def cargar_datos(ruta=DATASET_CSV):
    original = cargar_dataset_csv(ruta)
    filas = sorted(original.to_dict('records'), key=lambda r: str(r.get('id_propiedad') or ''))
    limpios, limpieza = limpiar_registros(filas)
    datos = _preparar_features(pd.DataFrame(limpios))
    return original, datos, limpieza


def huellas(ruta, datos):
    return {'archivo_sha256': hashlib.sha256(Path(ruta).read_bytes()).hexdigest(),
            'preparacion_sha256': hashlib.sha256(datos.to_json(orient='records', double_precision=15).encode()).hexdigest(),
            'codigo_modelo_sha256': hashlib.sha256((RAIZ/'modelo.py').read_bytes()).hexdigest(),
            'revision_republicaciones_sha256': hashlib.sha256((RAIZ/'dataset'/'revision_republicaciones.json').read_bytes()).hexdigest()}


def calcular_shap(modelo, X):
    """Atribuciones nativas comprobadas también en la escala final de dólares."""
    base = catboost_ajustado(modelo)
    pool = Pool(X, cat_features=base.get_cat_feature_indices())
    valores = np.asarray(base.get_feature_importance(pool, type='ShapValues', thread_count=4))
    raw = np.asarray(base.predict(pool, prediction_type='RawFormulaVal'))
    reconstruida = valores.sum(axis=1)
    np.testing.assert_allclose(reconstruida, raw, rtol=1e-10, atol=1e-10)
    usd = (modelo.transformer_.inverse_transform(reconstruida.reshape(-1, 1)).ravel()
           if isinstance(modelo, TransformedTargetRegressor) else reconstruida)
    np.testing.assert_allclose(usd, modelo.predict(X), rtol=1e-10, atol=1e-6)
    return {'metodo':'CatBoost ShapValues nativo', 'n':len(X),
            'error_aditividad':float(np.max(np.abs(reconstruida-raw))),
            'error_reconstruccion_usd':float(np.max(np.abs(usd-modelo.predict(X)))),
            'importancia_media_absoluta':dict(zip(X.columns, np.abs(valores[:, :-1]).mean(axis=0).tolist()))}, valores


def bootstrap_grupos(reales, pred, grupos, repeticiones=500):
    """Incertidumbre descriptiva con modelo fijo; no intervalos de tasación individual."""
    rng = np.random.default_rng(42)
    unicos = np.unique(grupos)
    posiciones = [np.flatnonzero(grupos == g) for g in unicos]
    muestras = []
    for _ in range(repeticiones):
        idx = np.concatenate([posiciones[i] for i in rng.integers(0, len(unicos), len(unicos))])
        r, p = reales[idx], pred[idx]
        muestras.append([np.mean(np.abs(p-r)/r)*100, np.mean(np.abs(p-r)),
                         np.sqrt(np.mean((p-r)**2)), np.median(np.abs(p-r)/r)*100])
    muestras = np.asarray(muestras)
    return {k:{'inferior_95':float(np.percentile(muestras[:, i], 2.5)),
               'superior_95':float(np.percentile(muestras[:, i], 97.5))}
            for i,k in enumerate(('mape_porcentaje','mae_usd','rmse_usd','mediana_error_porcentual'))}, muestras


def curva_interna(X, y, grupos, train, configuracion):
    a,b = next(GroupShuffleSplit(n_splits=1, test_size=.2, random_state=42).split(train, groups=grupos[train]))
    a,b = train[a],train[b]
    assert not set(grupos[a]) & set(grupos[b])
    directo = crear_modelo({**configuracion, 'transformacion_objetivo':'directo'})
    log = configuracion['transformacion_objetivo'] == 'log'
    ya,yb = (np.log(y[a]),np.log(y[b])) if log else (y[a],y[b])
    directo.fit(X.iloc[a], ya, eval_set=(X.iloc[b], yb), use_best_model=False)
    resultados = []
    for i,(pa,pb) in enumerate(zip(directo.staged_predict(X.iloc[a],eval_period=50),
                                 directo.staged_predict(X.iloc[b],eval_period=50)),1):
        if log:
            pa,pb = np.exp(pa),np.exp(pb)
        resultados.append({'arboles':min(i*50,directo.tree_count_),
                           'rmse_train':float(np.sqrt(np.mean((pa-y[a])**2))),
                           'rmse_validacion':float(np.sqrt(np.mean((pb-y[b])**2)))})
    return {'n_entrenamiento':len(a),'n_validacion':len(b),'puntos':resultados,
            'nota':'Grupos internos, sin early stopping ni selección de árboles.'}


def evaluar(ruta=DATASET_CSV):
    ruta = Path(ruta).expanduser().resolve()
    original, datos, limpieza = cargar_datos(ruta)
    X,y = datos[COLUMNAS_TEXTO+COLUMNAS_NUMERICAS],datos.precio_usd.to_numpy()
    grupos = agrupar_inmuebles(datos)
    train,test = dividir_datos(len(datos),grupos,20261028)
    configuracion = leer_configuracion()
    print('Evaluando el modelo vigente con cinco folds por grupos...',flush=True)
    modelo,informe,detalle = evaluar_modelo(crear_modelo(configuracion),X,y,grupos=grupos,random_state=20261028)
    pred = modelo.predict(X.iloc[test])
    referencia = SALIDA/'predicciones.csv'
    if referencia.exists() and (SALIDA/'metricas.json').exists():
        anterior = json.loads((SALIDA/'metricas.json').read_text())
        if anterior['huellas']['archivo_sha256']==hashlib.sha256(ruta.read_bytes()).hexdigest() and anterior['configuracion']==configuracion:
            r = pd.read_csv(referencia).set_index('id_propiedad')
            if set(r.index)==set(datos.iloc[test].id_propiedad):
                np.testing.assert_allclose(pred,r.loc[datos.iloc[test].id_propiedad,'precio_predicho_usd'],rtol=0,atol=1e-6,
                                           err_msg='Cambió la predicción: revisar antes de reemplazar la referencia.')
    print('Calculando SHAP, permutación y bootstrap por grupos...',flush=True)
    shap,valores = calcular_shap(modelo,X.iloc[test])
    intervalos,bootstrap = bootstrap_grupos(y[test],pred,grupos[test])
    perm = permutation_importance(modelo,X.iloc[test],y[test],scoring='neg_mean_absolute_percentage_error',
                                 n_repeats=3,random_state=42,n_jobs=1)
    informe.update({'fecha_utc':datetime.now(timezone.utc).isoformat(), 'configuracion':configuracion,
                    'huellas':huellas(ruta,datos),'limpieza':limpieza,'shap':shap,
                    'bootstrap':{'repeticiones':500,'unidad':'grupo heurístico de inmueble','intervalos':intervalos,
                                 'nota':'Modelo fijo y test explorado; no incluye incertidumbre de entrenamiento ni intervalos de tasación individual.'},
                    'permutacion':{c:{'aumento_mape_puntos':float(perm.importances_mean[i]*100),
                                      'desvio':float(perm.importances_std[i]*100)} for i,c in enumerate(X.columns)},
                    'curva_interna':curva_interna(X,y,grupos,train,configuracion),
                    'entrenamiento_aparente':calcular_metricas(y[train],modelo.predict(X.iloc[train])),
                    'versiones':{p:importlib.metadata.version(p) for p in ('catboost','scikit-learn','numpy','pandas')},
                    'columnas':list(X.columns)})
    detalle['id_propiedad'] = datos.iloc[detalle.indice_fila].id_propiedad.to_numpy()
    detalle['grupo_inmueble'] = grupos[detalle.indice_fila]
    detalle['tipo_propiedad'] = datos.iloc[detalle.indice_fila].tipo_propiedad.to_numpy()
    detalle['barrio_zona'] = datos.iloc[detalle.indice_fila].barrio_zona.to_numpy()
    SALIDA.mkdir(parents=True,exist_ok=True)
    (SALIDA/'metricas.json').write_text(json.dumps(informe,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
    detalle.to_csv(referencia,index=False)
    np.savez_compressed(SALIDA/'analisis.npz',shap=valores,bootstrap=bootstrap,
                        ids=datos.iloc[test].id_propiedad.to_numpy(dtype=str))
    print(json.dumps(informe['prueba'],ensure_ascii=False,indent=2),flush=True)
    return original,datos,informe,detalle


def cargar_resultados(ruta=DATASET_CSV):
    original,datos,_ = cargar_datos(ruta)
    informe = json.loads((SALIDA/'metricas.json').read_text())
    if informe['huellas']!=huellas(ruta,datos) or informe['configuracion']!=leer_configuracion():
        raise ValueError('Fuente, limpieza, código o configuración cambió. Repetir la evaluación antes de reutilizar resultados.')
    detalle = pd.read_csv(SALIDA/'predicciones.csv')
    grupos = agrupar_inmuebles(datos)
    _,test = dividir_datos(len(datos),grupos,20261028)
    if set(detalle.id_propiedad)!=set(datos.iloc[test].id_propiedad):
        raise ValueError('Las propiedades de prueba cambiaron.')
    referencia = detalle.set_index('id_propiedad').loc[datos.iloc[test].id_propiedad]
    np.testing.assert_allclose(referencia.precio_observado_usd,datos.iloc[test].precio_usd,rtol=0,atol=1e-6)
    np.testing.assert_array_equal(referencia.grupo_inmueble,grupos[test])
    return original,datos,informe,detalle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv',type=Path,default=Path(os.environ.get('MODELO_DATASET_CSV') or DATASET_CSV))
    parser.add_argument('--solo-informe',action='store_true',help='Usa resultados verificados sin volver a entrenar.')
    args = parser.parse_args()
    resultados = cargar_resultados(args.csv) if args.solo_informe else evaluar(args.csv)
    from .generar_informe import generar_informe
    generar_informe(*resultados)


if __name__=='__main__':
    main()
