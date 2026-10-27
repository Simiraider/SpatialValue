"""Ejecutar desde la raíz: PYTHONPATH=src/pages/Apis python -m modelo_ia.evaluar_neon.

Consulta de solo lectura; no importa FastAPI, no publica ni cambia el modelo activo.
"""
import hashlib
import importlib.metadata
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import psycopg2
from dotenv import dotenv_values
from .modelo import (
    CONSULTA_ENTRENAMIENTO, COLUMNAS_TEXTO, COLUMNAS_NUMERICAS,
    limpiar_registros, _preparar_features, crear_modelo, evaluar_modelo,
)


def main():
    raiz = Path(__file__).resolve().parents[4]
    config = dotenv_values(raiz / '.env.local')
    url = os.environ.get('SpatialValueStorage_DATABASE_URL') or config.get('SpatialValueStorage_DATABASE_URL')
    if not url:
        raise SystemExit('Falta SpatialValueStorage_DATABASE_URL en .env.local o en el entorno.')
    try:
        conn = psycopg2.connect(url, connect_timeout=15, sslmode='require')
        try:
            conn.set_session(readonly=True)
            with conn.cursor() as cur:
                cur.execute('SET LOCAL statement_timeout = 60000')
                cur.execute(CONSULTA_ENTRENAMIENTO)
                filas = [dict(zip([c.name for c in cur.description], r)) for r in cur.fetchall()]
            conn.rollback()
        finally:
            conn.close()
    except psycopg2.Error:
        raise SystemExit('No se pudo consultar Neon. Revisar conectividad y credenciales; no se imprimen secretos.') from None
    # Orden estable para que la misma extracción produzca las mismas particiones.
    filas.sort(key=lambda r: str(r.get('id_propiedad') or ''))
    registros, limpieza = limpiar_registros(filas)
    df = _preparar_features(pd.DataFrame(registros))
    _, informe, detalle = evaluar_modelo(crear_modelo(), df[COLUMNAS_TEXTO + COLUMNAS_NUMERICAS], df.precio_usd)
    informe.update({
        'fecha_utc': datetime.now(timezone.utc).isoformat(),
        'fuente': 'Neon: misma consulta, limpieza, features y RandomForest de la API; extracción ordenada por ID',
        'limpieza': limpieza,
        'huella_dataset_sha256': hashlib.sha256(df.to_json(orient='records', double_precision=15).encode()).hexdigest(),
        'versiones': {p: importlib.metadata.version(p) for p in ['scikit-learn', 'pandas', 'numpy']},
        'modelo': {'algoritmo': 'RandomForestRegressor', 'n_estimators': 100, 'random_state': 42, 'hiperparametros': crear_modelo().named_steps['modelo'].get_params()},
    })
    detalle['id_propiedad'] = [registros[int(i)].get('id_propiedad') for i in detalle.indice_fila]
    detalle['tipo_propiedad'] = [df.iloc[int(i)].tipo_propiedad for i in detalle.indice_fila]
    salida = Path(__file__).resolve().parent / 'auditoria' / 'evaluacion'
    salida.mkdir(parents=True, exist_ok=True)
    (salida / 'metricas_modelo.json').write_text(json.dumps(informe, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    detalle.to_csv(salida / 'predicciones_prueba.csv', index=False)
    graficar(detalle, informe, salida)
    print(json.dumps({k:informe[k] for k in ['limpieza','n_entrenamiento','n_prueba','prueba','referencia_mediana_prueba','cross_validation','cobertura_tipo_propiedad']},ensure_ascii=False,indent=2))


def graficar(detalle, informe, salida):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 3, figsize=(16, 5))
    axes[0].scatter(detalle.precio_observado_usd, detalle.precio_predicho_usd, alpha=.6, s=16)
    limites = [min(detalle.precio_observado_usd.min(), detalle.precio_predicho_usd.min()), max(detalle.precio_observado_usd.max(), detalle.precio_predicho_usd.max())]
    axes[0].plot(limites, limites, '--', color='gray')
    axes[0].set(xscale='log', yscale='log', xlabel='Precio observado (USD)', ylabel='Predicción (USD)', title='Prueba: observado vs. predicho · escala log')
    ps = informe['prueba']['percentiles_error_porcentual']
    bars=axes[1].bar(list(ps), list(ps.values()), color='#247BA0')
    axes[1].bar_label(bars, fmt='%.1f', padding=3)
    axes[1].set(title='Percentiles del error absoluto relativo', ylabel='Error (%)')
    axes[1].set_ylim(0, max(ps.values()) * 1.15 or 1)
    folds=informe['cross_validation']['folds']
    axes[2].bar([str(f['fold']) for f in folds], [f['mae_usd'] for f in folds], color='#247BA0')
    axes[2].set(title='Validación cruzada sobre entrenamiento', xlabel='Fold', ylabel='MAE (USD)')
    fig.suptitle(f'Random Forest actual · {informe["n_entrenamiento"]} entrenamiento / {informe["n_prueba"]} prueba')
    fig.tight_layout();fig.savefig(salida/'evaluacion_modelo.png',dpi=160);plt.close(fig)


if __name__ == '__main__':
    main()
