# Modelo CatBoost de SpatialValue

El documento principal es [Evolución y evaluación de CatBoost](informe/INFORME_CATBOOST.html). Abrilo en el navegador: incluye todos los cambios desde la incorporación de CatBoost, explicaciones para aprender, 9 gráficos fundamentales y tablas completas. Cada gráfico también está disponible como PNG en `informe/graficos/`.

## Estado actual

Se estima precio publicado en USD de viviendas individuales. No se dispone de precios de cierre verificados. La fuente actual es `dataset/propiedades.csv`, con 3.917 filas; después de limpiar quedan 3.375. El modelo recibe seis categorías y 24 variables numéricas. No entrena con su propio precio estimado ni abre PostgreSQL/Neon.

Se mantienen logaritmo del precio, pérdida RMSE, profundidad 6, 1.400 árboles, tasa 0,03 y L2 igual a 1. La API usa estas mismas funciones y configuración. Esta limpieza no cambia sus parámetros, no reinicia servicios y no modifica backend ni frontend.

Los parámetros se leen de `configuracion_catboost.json`; si falta, el entrenamiento devuelve un error. Los análisis por tipo, barrio y precio se calculan una sola vez, en `evaluacion_segmentos`. Se retiraron los resúmenes duplicados y el centrado logarítmico del experimento con Huber.

| Métrica en prueba | Resultado |
|---|---:|
| Publicaciones / grupos | 674 / 600 |
| Grupos compartidos con entrenamiento | 0 |
| MAE | USD 135.473 |
| RMSE | USD 609.222 |
| MAPE | 21,48% |
| Mediana del error porcentual | 16,10% |
| Percentil 90 | 46,68% |
| R² | 0,508 |

Las 674 predicciones se compararon una por una antes y después de ordenar el proyecto: **diferencia máxima USD 0**. El MAPE histórico de 23,69% incluía una oferta de dos casas linderas, excluida por alcance verificado; bajar a 21,48% por retirarla es un cambio de población, no una mejora de las otras predicciones.

La CV de evaluación usa cinco folds de grupos solo en las 2.701 filas de desarrollo: MAPE 21,76% con desvío entre folds de 1,04 puntos. La selección de las seis variantes posteriores utilizó otros folds internos y dio 21,89% para la base. Son protocolos distintos; no se mezclan sus cifras. Este CSV ya fue explorado y requiere confirmación con una muestra futura verificada.

## Qué quedó y por qué

| Archivo o carpeta | Función |
|---|---|
| `modelo.py` | Carga, limpieza, variables, CatBoost, grupos y evaluación compartidas con la API |
| `evaluar_dataset.py` | Evaluación actual, SHAP, curva interna, bootstrap por grupos y permutación |
| `generar_informe.py` | Documento HTML, tablas y gráficos individuales; no selecciona ni cambia el modelo |
| `test_modelo.py` | Pruebas del flujo activo, métricas, fuga entre grupos, identidad de republicaciones y SHAP |
| `configuracion_catboost.json` | Parámetros activos, sin credenciales ni pesos |
| `dataset/propiedades.csv` | Fuente de entrenamiento, preservada durante esta limpieza |
| `dataset/revision_republicaciones.json` | Decisiones e identidad verificadas para no eliminar unidades diferentes |
| `auditoria/actual/metricas.json` | Métricas, configuración, hashes y análisis actuales |
| `auditoria/actual/predicciones.csv` | Predicciones por ID y grupo; también funciona como referencia de regresión |
| `auditoria/actual/analisis.npz` | Aportes SHAP y remuestreos bootstrap para regenerar gráficos sin entrenar |
| `auditoria/historial_catboost.zip` | Respaldo verificado de resultados y código anteriores, fuentes y CSV original previo a las seis copias eliminadas |
| `informe/` | Documento principal y sus 9 gráficos fundamentales |

Se retiraron del flujo activo los especialistas por tipo, sus transformaciones experimentales, las búsquedas antiguas, imágenes repetidas, informes parciales y cachés. Las variantes descartadas permanecen en el historial para mantener la evidencia de por qué no se adoptaron. El ZIP no participa en la predicción de la API; solo se consulta para documentar la evolución.

## Reglas de datos que siguen vigentes

- Se preservan ceros válidos y faltantes; no se inventan características ni precios.
- Se rechazan alquileres, operaciones no confirmadas, precios inválidos y características incoherentes.
- Se excluyen desarrollos completos, ventas en bloque, una superficie contradictoria verificada y la oferta revisada de dos casas linderas.
- La categoría de la URL corrige tipos mal copiados. Las republicaciones solo se eliminan con identidad verificada y huellas vigentes.
- Dirección o GPS y estructura generan grupos preventivos, sin usar precio. Un grupo no certifica identidad catastral.
- Cubierta debe ser positiva y no superar total bajo el contrato actual. Se documentaron 37 casas que requieren distinguir terreno y construido antes de reincorporarlas; la API también aplica esa restricción.
- No se eliminan anuncios por ser caros, grandes o por tener un error alto. Las alertas estadísticas generan revisión.

## Cómo ejecutar

Desde la raíz del repositorio, en el entorno Python con las dependencias del modelo:

```sh
PYTHONPATH=src/pages/Apis python -m unittest modelo_ia.test_modelo -v
PYTHONPATH=src/pages/Apis python -m modelo_ia.evaluar_dataset
PYTHONPATH=src/pages/Apis python -m modelo_ia.evaluar_dataset --solo-informe
```

`--solo-informe` verifica fuente, preparación, configuración, identidad de prueba y código; reutiliza las predicciones sin entrenar. Si esos elementos cambian, exige evaluar de nuevo. Se admite `--csv /ruta/propiedades.csv`; también se conserva `MODELO_DATASET_CSV`.

El evaluador compara una nueva ejecución con las predicciones anteriores cuando fuente, configuración e IDs coinciden y se detiene si cambian antes de reemplazarlas. Una modificación deliberada del modelo debe revisarse explícitamente, no aceptarse como una simple limpieza.

Para consultar el historial sin extraerlo:

```sh
python -m zipfile -l src/pages/Apis/modelo_ia/auditoria/historial_catboost.zip
```

El respaldo se verificó antes de retirar las copias activas. Los archivos anteriores mantienen sus rutas relativas dentro del ZIP; incluye el CSV original de 3.923 filas y el registro de las seis eliminaciones.
