# Evaluación del Random Forest actual

## Organización

- `modelo.py`: consulta SQL, limpieza, preparación de variables, construcción de Random Forest y evaluación. Las funciones están agrupadas por esas etapas. Importarlo no conecta a Neon ni entrena.
- `evaluar_neon.py`: conecta a Neon en modo de solo lectura y genera resultados usando las funciones de `modelo.py`.
- `test_modelo.py`: reúne las pruebas de limpieza y evaluación, sin conexión a la base.
- `auditoria/evaluacion/`: resultados de la última evaluación guardada.

Ejecutar las pruebas desde la raíz:

```sh
PYTHONPATH=src/pages/Apis python -m unittest modelo_ia.test_modelo -v
```

Ejecutar desde la raíz, con las dependencias Python del modelo y Matplotlib instaladas:

```sh
PYTHONPATH=src/pages/Apis python -m modelo_ia.evaluar_neon
```

La conexión se lee de `SpatialValueStorage_DATABASE_URL` en el entorno o `.env.local`. La consulta a Neon es de solo lectura. El comando no importa el servidor FastAPI, no modifica tablas y no publica el modelo entrenado.

## Qué mide

- **MAE (USD):** promedio del error absoluto. Un MAE de 20.000 significa un desvío absoluto promedio de USD 20.000 en esa muestra.
- **RMSE (USD):** raíz del promedio del error al cuadrado; da más peso a errores grandes.
- **MAPE (%):** promedio de errores absolutos relativos al precio observado. Puede aumentar mucho en propiedades baratas; requiere precios positivos.
- **R²:** mejora del error cuadrático respecto de la media de los precios de la muestra evaluada. No es un porcentaje de aciertos. Puede ser negativo; se informa null si todos los precios reales son iguales.
- **Cross-validation:** cinco modelos entrenados desde cero sobre diferentes particiones del conjunto de entrenamiento; se guardan métricas por fold, media y desviación estándar muestral. No incluye el conjunto final de prueba.
- **Percentiles:** p50, p75, p90, p95, p99 y p100 del error absoluto en USD y del error absoluto relativo en porcentaje. p90 de USD 50.000 significa que el 90% de los errores observados no supera ese importe. No constituye un intervalo predictivo para una propiedad nueva.

## Protocolo

Se conservan las features, limpieza y los 100 árboles con semilla 42 del modelo actual. La extracción se ordena por ID para repetir particiones sobre los mismos registros. El 20% se reserva para prueba; la validación cruzada usa solo el 80% restante. Cada fold aprende su propio encoder e imputación. El modelo devuelto se ajusta al 80%, sin reentrenarlo con el test. Se compara contra una predicción constante igual a la mediana del entrenamiento.

La consulta y el pipeline se comparten con FastAPI: la API también evalúa cada entrenamiento y registra las métricas. La evaluación agrega cinco ajustes al entrenamiento, aumentando su tiempo de ejecución. No se impone todavía un umbral para promover o rechazar candidatos.

## Archivos generados

En `auditoria/evaluacion/`:

- `metricas_modelo.json`: métricas, folds, cobertura por categoría, parámetros, versiones y huella SHA-256 de los datos preparados.
- `predicciones_prueba.csv`: predicciones y errores del conjunto de prueba, con ID del anuncio.
- `evaluacion_modelo.png`: predicción frente a precio observado, percentiles y MAE por fold.

## Límites

La división es aleatoria, no temporal ni agrupada por inmueble. Las republicaciones pueden hacer que las métricas sean optimistas. Los precios y etiquetas originales aún requieren verificación; las reglas actuales no detectan todos los errores. Se mantiene el criterio actual para identificar ventas por URL: no se reinterpreta `compra` en este cambio. Una buena métrica global puede ocultar errores en PH o departamentos con pocos ejemplos. No se utiliza el JSON histórico para entrenar esta evaluación. No se ajustan hiperparámetros usando los resultados del test.
