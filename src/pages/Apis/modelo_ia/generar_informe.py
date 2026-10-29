"""Documento de aprendizaje y gráficos individuales del modelo vigente.

Solo lee resultados verificados y el historial comprimido. No ajusta el modelo.
"""
from html import escape
import json
import re
import zipfile

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import Normalize
from matplotlib.cm import ScalarMappable

from .modelo import COLUMNAS_TEXTO
from .evaluar_dataset import RAIZ, SALIDA

DESTINO = RAIZ/'informe'
MARCADOR_GUIA = '\n\nRECORRIDO DE MODELO.PY Y TEST_MODELO.PY\n'
AZUL, NARANJA, VERDE = '#176b91', '#cf7a18', '#34845a'
NOMBRES = {'tipo_propiedad':'Tipo de propiedad','barrio_zona':'Barrio declarado','estado':'Estado',
           'orientacion':'Orientación','disposicion':'Disposición','seguridad_tipo':'Tipo de seguridad',
           'superficie_total_m2':'Superficie total','superficie_cubierta_m2':'Superficie cubierta',
           'anios_de_antiguedad':'Antigüedad','expensas_ars':'Expensas ARS','latitud':'Latitud','longitud':'Longitud',
           'banos':'Baños','ambientes':'Ambientes','dormitorios':'Dormitorios','piso':'Piso',
           'cochera':'Cochera','balcon':'Balcón','terraza':'Terraza','patio':'Patio','pileta':'Pileta',
           'parrilla':'Parrilla','seguridad_24hs':'Seguridad 24 horas','ascensor':'Ascensor','baulera':'Baulera',
           'sum':'SUM','camara':'Cámara','gym':'Gimnasio','lounge':'Lounge','laundry':'Lavandería'}
PRECIOS = {'hasta_100k':'Hasta 100 mil','100k_250k':'100 a 250 mil','250k_500k':'250 a 500 mil',
           '500k_1m':'500 mil a 1 millón','mas_1m':'Más de 1 millón'}


def numero(v, decimales=2):
    if v is None:
        return '—'
    return f'{v:,.{decimales}f}'.replace(',','@').replace('.',',').replace('@','.')


def tabla(cabeceras, filas):
    return '<div class="tabla"><table><thead><tr>'+''.join(f'<th>{escape(str(c))}</th>' for c in cabeceras)+'</tr></thead><tbody>'+''.join(
        '<tr>'+''.join(f'<td>{escape(str(c))}</td>' for c in fila)+'</tr>' for fila in filas)+'</tbody></table></div>'


class Documento:
    def __init__(self):
        self.partes=[]
        self.indice=[]
        self.figuras=[]

    def capitulo(self, identificador, titulo, texto=''):
        self.indice.append((identificador,titulo))
        self.partes.append(f'<h2 id="{identificador}">{escape(titulo)}</h2>')
        if texto:self.parrafo(texto)

    def parrafo(self, texto):
        self.partes.append('<p>'+texto+'</p>')

    def nuevo(self, ancho=10, alto=5.6):
        return plt.subplots(figsize=(ancho,alto))

    def grafico(self, fig, slug, titulo, lectura, conclusion, limite=''):
        archivo=f'{len(self.figuras)+1:02d}_{slug}.png'
        fig.suptitle(titulo,fontsize=14,fontweight='normal',y=.99)
        fig.tight_layout(rect=(0,.015,1,.95))
        fig.savefig(DESTINO/'graficos'/archivo,dpi=150,facecolor='white')
        ancho,alto=np.rint(fig.get_size_inches()*150).astype(int)
        plt.close(fig)
        self.figuras.append({'archivo':archivo,'titulo':titulo,'lectura':lectura,'conclusion':conclusion,'limite':limite})
        self.partes.append(f'<section class="analisis" id="grafico-{len(self.figuras)}"><h3>{len(self.figuras)}. {escape(titulo)}</h3>'
                           f'<p>{lectura}</p><a href="graficos/{archivo}" target="_blank"><img width="{ancho}" height="{alto}" loading="lazy" src="graficos/{archivo}" alt="{escape(titulo)}"></a>'
                           f'<p><strong>Qué aprendemos.</strong> {conclusion}</p>'
                           +(f'<p class="limite">{limite}</p>' if limite else '')+'</section>')


def barras(ax, etiquetas, valores, horizontal=False, color=AZUL, decimales=0):
    if horizontal:
        b=ax.barh(etiquetas,valores,color=color);ax.invert_yaxis()
    else:
        b=ax.bar(etiquetas,valores,color=color)
    ax.bar_label(b,labels=[numero(v,decimales) for v in valores],padding=4,fontsize=9)
    if min(valores,default=0)>=0:
        if horizontal:ax.set_xlim(0,max(valores,default=1)*1.2 or 1)
        else:ax.set_ylim(0,max(valores,default=1)*1.2 or 1)
    ax.spines[['top','right']].set_visible(False)


def historicos():
    with zipfile.ZipFile(RAIZ/'auditoria'/'historial_catboost.zip') as z:
        viejo=json.loads(z.read('auditoria/evaluacion/metricas_modelo.json'))
        mejoras=json.loads(z.read('auditoria/mejoras_segmentos/metricas_mejoras.json'))
    return viejo,mejoras


def generar_informe(original, datos, informe, detalle):
    DESTINO.mkdir(exist_ok=True);(DESTINO/'graficos').mkdir(exist_ok=True)
    anterior=DESTINO/'INFORME_CATBOOST.html'
    graficos_anteriores=set(re.findall(r'<img[^>]+src="graficos/([0-9]{2}_[a-z0-9_]+\.png)"',anterior.read_text(encoding='utf-8'))) if anterior.exists() else set()
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.labelsize':10,'axes.grid':False})
    doc=Documento();viejo,mejoras=historicos()
    with np.load(SALIDA/'analisis.npz') as cache:
        np.testing.assert_array_equal(cache['ids'],detalle.id_propiedad.to_numpy(dtype=str))
        shap=cache['shap']
    X=datos.iloc[detalle.indice_fila][informe['columnas']].reset_index(drop=True)
    real,pred=detalle.precio_observado_usd.to_numpy(),detalle.precio_predicho_usd.to_numpy()
    absoluto=np.abs(pred-real)/real*100
    m=informe['prueba'];segmentos=informe['evaluacion_segmentos']
    filas=[('MAE',f'USD {numero(m["mae_usd"],0)}','Tamaño medio del error en dólares'),
           ('RMSE',f'USD {numero(m["rmse_usd"],0)}','Penaliza más los errores grandes'),
           ('MAPE',numero(m['mape_porcentaje'])+'%','Error porcentual absoluto promedio'),
           ('Mediana',numero(m['percentiles_error_porcentual']['p50'])+'%','La mitad de los errores queda por debajo'),
           ('P90',numero(m['percentiles_error_porcentual']['p90'])+'%','Nueve de cada diez quedan por debajo en esta prueba'),
           ('R²',numero(m['r2'],3),'Comparación con la media observada del test; no es porcentaje de aciertos')]
    doc.capitulo('resultado','Resultado actual',
        'SpatialValue estima el <strong>precio publicado en USD de una vivienda individual</strong>. Se mantiene CatBoost general, entrenado con logaritmo del precio y pérdida RMSE. Las variables nuevas y los modelos por tipo no mejoraron la validación y quedaron fuera del flujo activo.')
    doc.partes.append(tabla(['Métrica','Resultado','Cómo interpretarla'],filas))
    doc.parrafo(f'La evaluación usa <strong>{informe["n_entrenamiento"]} publicaciones de entrenamiento y {len(real)} de prueba</strong>, con {informe["grupos"]["prueba"]} grupos de prueba y cero grupos compartidos. La mediana de error es {numero(m["percentiles_error_porcentual"]["p50"])}%, pero hay errores grandes que elevan el promedio. MAPE de 21,48% no significa 78,52% de aciertos.')
    doc.parrafo('La baja de MAPE desde 23,69% a 21,48% se explica por excluir una oferta verificada de dos casas linderas. Las predicciones de las 674 viviendas comunes permanecieron iguales. Durante esta limpieza volvieron a compararse una por una: diferencia máxima <strong>USD 0</strong>.')
    doc.parrafo('Los datos ya se exploraron durante el desarrollo. Estos resultados describen esta muestra; la comprobación final requiere propiedades futuras verificadas. No hay precios de cierre con los que medir el error respecto de ventas efectivas.')

    doc.capitulo('evolucion','Qué cambiamos desde que incorporamos CatBoost')
    pasos=[
        ('Unificamos el recorrido de los datos','La API y el evaluador comparten carga, limpieza, variables y construcción de CatBoost en modelo.py. El evaluador no importa FastAPI, no abre Neon y no usa el precio estimado por la IA como etiqueta. La fuente actual es la copia local del CSV que aportaste; no es una extracción nueva de PostgreSQL.'),
        ('Revisamos la limpieza','Se preservaron ceros válidos y datos desconocidos; desconocido no se convierte en ausencia. Se rechazan alquileres, operaciones no confirmadas, precios no positivos, superficies incompatibles y características incoherentes. La categoría codificada en el anuncio corrige tipos mal copiados. El CSV permanece intacto salvo las seis republicaciones verificadas eliminadas en la etapa anterior.'),
        ('Contrastamos anuncios problemáticos','Se excluyeron desarrollos completos, ventas en bloque, una superficie contradictoria y la oferta de dos casas linderas. Se utilizaron fuentes e identidad del anuncio, no un umbral de error del modelo. Los casos que no pudieron verificarse se conservaron. No se corrigieron precios históricos utilizando precios actuales.'),
        ('Controlamos las republicaciones','Se verificaron seis copias y se conservaron respaldos. El catálogo mantiene IDs, decisiones y huellas de identidad. Además, las publicaciones con dirección o GPS y estructura semejantes se agrupan al separar entrenamiento y prueba. Esa agrupación es preventiva: puede reunir unidades diferentes y no demuestra identidad catastral.'),
        ('Mejoramos la evaluación','Agregamos MAE, RMSE, MAPE, R², cinco folds por grupos y percentiles. El procesamiento de cada modelo aprende únicamente de su entrenamiento. Se incluyó una referencia sencilla que siempre predice la mediana de los precios de entrenamiento.'),
        ('Probamos cómo tratar el precio','Se compararon precio directo, logaritmo y pérdidas RMSE, MAE y Huber. El logaritmo convierte diferencias multiplicativas en diferencias aditivas: 100.000 a 120.000 y 1.000.000 a 1.200.000 tienen la misma razón 1,2. Se conservó log + RMSE; ninguna alternativa ganó todos los indicadores.'),
        ('Ajustamos los árboles','Se compararon 25 configuraciones con folds internos. Quedaron profundidad 6, 1.400 árboles, tasa 0,03 y L2 igual a 1. El ajuste redujo errores en dólares en el test histórico, pero su MAPE aumentó ligeramente. No se ocultó esa diferencia.'),
        ('Agregamos explicaciones SHAP','Se calculan aportes nativos de CatBoost para cada propiedad y se verifica que, sumados al valor base, reconstruyan la predicción. Ayudan a entender el comportamiento del modelo; no prueban que una variable cause un precio.'),
        ('Evaluamos por segmento','Se midieron tipos, barrios, rangos de precio y cruces tipo por precio, con conteos de publicaciones y grupos. Se incluyeron sesgo, mediana y porcentajes dentro de márgenes. Con menos de cinco ejemplos no se publica una métrica agregada; con menos de treinta grupos se marca muestra pequeña. Son umbrales operativos.'),
        ('Probamos cuatro revisiones separadas','Se verificó el caso extremo, se probaron límites de barrios y coordenadas, nueve variables de superficie y especialistas por tipo. La comparación incluyó seis alternativas y mantuvo el mismo test común. Ninguna mejoró el MAPE interno; se mantuvo el modelo general.'),
        ('Simplificamos el proyecto','Se archivaron código e informes de experimentos descartados en un solo ZIP verificado. El flujo activo queda en modelo.py, evaluar_dataset.py, generar_informe.py y test_modelo.py. Se conservan la configuración, el CSV y el catálogo de identidad. Los nuevos análisis describen el mismo modelo y no seleccionan variables usando el test.')]
    for i,(titulo,texto) in enumerate(pasos,1):
        doc.partes.append(f'<h3>{i}. {titulo}</h3>');doc.parrafo(texto)
    doc.parrafo('CatBoost construye árboles en secuencia: cada etapa ajusta lo que la combinación anterior todavía no explica. Las categorías se entregan como texto normalizado y los números desconocidos como NaN. Al entrenar se aplica log(precio); al responder se aplica la inversa y se devuelven dólares. Más árboles no garantizan más precisión; por eso elegimos parámetros con validación interna.')
    doc.partes.append(tabla(['Configuración actual','Valor'],[(k,v) for k,v in informe['configuracion']['parametros'].items()]+[('Objetivo','log(precio USD)'),('Semilla CatBoost',42),('Variables',len(informe['columnas']))]))

    doc.capitulo('datos','Calidad y cobertura de los datos',
                 f'El CSV de trabajo tiene {len(original)} publicaciones y quedan {len(datos)} válidas después de la limpieza. Conservamos tres gráficos para revisar representación, faltantes y precios. Los extremos no se eliminan automáticamente por ser caros o grandes.')
    conteos=datos.tipo_propiedad.value_counts();fig,ax=doc.nuevo()
    barras(ax,conteos.index.str.title(),conteos.values);ax.set_ylabel('Publicaciones válidas')
    doc.grafico(fig,'tipos','Representación de casas departamentos y PH','Cada barra cuenta ejemplos válidos de un tipo de propiedad.',
                'PH tiene menos datos que casas y departamentos. Esa cobertura debe acompañar la comparación de errores; no se inventan ejemplos para equilibrar la regresión.')
    faltantes={c:float((datos[c].isna()|(datos[c].eq('no especificada') if c in COLUMNAS_TEXTO else False)).mean()*100) for c in informe['columnas']}
    orden=sorted(faltantes,key=faltantes.get,reverse=True);fig,ax=doc.nuevo(11,10)
    barras(ax,[NOMBRES.get(c,c) for c in orden],[faltantes[c] for c in orden],True,decimales=1);ax.set_xlabel('Valores desconocidos (%)')
    doc.grafico(fig,'faltantes','Datos faltantes por variable','Se cuenta NaN en números y la etiqueta no especificada en categorías.',
                'Desconocido no significa ausente: una antigüedad desconocida no se convierte en cero años. Una columna completa tampoco garantiza calidad; SUM figura verdadero en todos los valores conocidos y requiere revisar su origen.')
    fig,ax=doc.nuevo()
    ax.hist(datos.precio_usd,bins=np.geomspace(datos.precio_usd.min(),datos.precio_usd.max(),45),color=AZUL)
    ax.set(xscale='log',xlabel='Precio publicado USD en escala logarítmica',ylabel='Publicaciones')
    doc.grafico(fig,'precios','Distribución de precios publicados','El eje logarítmico permite ver viviendas económicas y muy caras en el mismo gráfico.',
                'La cola de precios altos ayuda a explicar por qué pocos errores pueden dominar RMSE y MAE. No se recorta esa cola para mejorar métricas. CatBoost aprende log(precio) y luego vuelve a dólares.')

    doc.capitulo('errores','Qué tan cerca quedan las estimaciones',
                 'Los siguientes gráficos usan las publicaciones de prueba y conservan todos sus errores. Los valores son precios publicados, no precios de cierre.')
    fig,ax=doc.nuevo();ax.scatter(real,pred,s=20,alpha=.5,c=AZUL)
    lim=[min(real.min(),pred.min()),max(real.max(),pred.max())];ax.plot(lim,lim,'k--',lw=1)
    ax.set(xscale='log',yscale='log',xlabel='Precio publicado USD',ylabel='Precio estimado USD')
    doc.grafico(fig,'observado_predicho','Precio observado frente a estimado','Cada punto es una vivienda. La diagonal representa una estimación exacta; ambos ejes son logarítmicos.',
                'Por encima se sobreestima y por debajo se subestima. La dispersión del extremo caro importa especialmente para los errores en dólares.')
    referencia=informe['referencia_mediana_prueba']
    doc.parrafo('La referencia sencilla asigna a todas las viviendas la mediana de precios de entrenamiento. Menor error es mejor; en R², mayor es mejor. R² puede ser negativo y no representa porcentaje de aciertos.')
    doc.partes.append(tabla(['Métrica','CatBoost actual','Referencia mediana'],[
        (nombre,numero(m[campo],decimales),numero(referencia[campo],decimales))
        for campo,nombre,decimales in [('mae_usd','MAE USD',0),('rmse_usd','RMSE USD',0),('mape_porcentaje','MAPE %',2),('r2','R²',3)]]))
    percentiles=m['percentiles_error_porcentual'];fig,ax=doc.nuevo()
    barras(ax,[k.upper() for k in percentiles],list(percentiles.values()),decimales=1);ax.set_ylabel('Error porcentual absoluto (%)')
    doc.grafico(fig,'percentiles','Mediana y cola de errores','P50 es la mediana; P90 deja por debajo el 90% de los casos y P100 es el máximo observado.',
                f'P50 es {numero(percentiles["p50"])}% y P90 es {numero(percentiles["p90"])}%. La distancia entre ambos muestra cuánto se amplía el error en los casos difíciles.')
    doc.partes.append(tabla(['Margen respecto del precio publicado','Publicaciones de prueba dentro del margen'],[
        (f'±{umbral}%',numero(np.mean(absoluto<=umbral+1e-12)*100,1)+'%') for umbral in (10,20,30)]))
    doc.parrafo('Estos márgenes describen frecuencias de esta muestra; no son probabilidades garantizadas para una propiedad nueva.')

    doc.capitulo('validacion','Estabilidad y riesgo de sobreajuste',
                 'La validación cruzada utiliza solo el conjunto de desarrollo. Las publicaciones de un mismo grupo permanecen juntas para reducir el riesgo de evaluar copias ya vistas.')
    folds=informe['cross_validation']['folds'];fig,ax=doc.nuevo()
    barras(ax,[f'Fold {f["fold"]}' for f in folds],[f['mape_porcentaje'] for f in folds],decimales=2);ax.set_ylabel('MAPE de validación (%)')
    cv=informe['cross_validation']['resumen']['mape_porcentaje']
    doc.grafico(fig,'cross_validation','Variación entre cinco particiones internas','Cada fold valida grupos que su modelo no vio al entrenar. Todos pertenecen al conjunto de desarrollo.',
                f'La media es {numero(cv["media"])}% y el desvío entre folds {numero(cv["desvio_estandar"])} puntos. El desvío no es un intervalo de confianza y esta CV no sustituye una muestra externa.')
    doc.partes.append(tabla(['Conjunto','MAPE'],[
        ('Entrenamiento aparente',numero(informe['entrenamiento_aparente']['mape_porcentaje'])+'%'),
        ('Prueba reservada',numero(m['mape_porcentaje'])+'%')]))
    doc.parrafo('El error en ejemplos usados para aprender es optimista. La diferencia con prueba obliga a vigilar sobreajuste. La curva de árboles, calculada en una validación interna separada, queda registrada en metricas.json; no se usa este test para elegir dónde detener el entrenamiento.')

    graficar_segmentos(doc,segmentos)
    graficar_explicaciones(doc,X,shap)
    resumir_historia(doc,viejo,mejoras)
    anexos(doc,informe,detalle)
    escribir_html(doc,informe)
    vigentes={f['archivo'] for f in doc.figuras}
    for nombre in graficos_anteriores-vigentes:
        archivo=DESTINO/'graficos'/nombre
        if archivo.is_file():
            archivo.unlink()
    print(f'Documento generado con {len(doc.figuras)} gráficos individuales: {DESTINO/"INFORME_CATBOOST.html"}',flush=True)


def graficar_segmentos(doc,segmentos):
    doc.capitulo('segmentos','Dónde funciona mejor y dónde falla',
                 'Los segmentos utilizan las mismas predicciones de prueba. El rango se define con el precio observado solo para diagnosticar; ese precio no se conoce cuando se tasa una vivienda nueva.')
    for dimension,titulo,slug in [('por_tipo','Error por tipo de propiedad','error_tipo'),('por_precio','Error por rango de precio observado','error_precio')]:
        vals=segmentos[dimension];nombres=[n for n in vals if vals[n]['metricas'] is not None]
        x=np.arange(len(nombres));fig,ax=doc.nuevo(11,6)
        ax.bar(x-.2,[vals[n]['metricas']['mape_porcentaje'] for n in nombres],.4,label='MAPE',color=AZUL)
        ax.bar(x+.2,[vals[n]['metricas']['percentiles_error_porcentual']['p50'] for n in nombres],.4,label='Mediana',color=NARANJA)
        ax.set_xticks(x,[(PRECIOS.get(n,n.title()))+f'\nn={vals[n]["n_prueba"]}, g={vals[n]["grupos_prueba"]}'+(' *' if vals[n]['muestra_pequena'] else '') for n in nombres],fontsize=9)
        ax.set_ylabel('Error porcentual absoluto (%)');ax.legend()
        conclusion=('Las casas conservan más error que departamentos y PH. La diferencia entre MAPE y mediana muestra la influencia de los errores extremos.' if dimension=='por_tipo' else
                    'La precisión cambia según el precio. En el extremo caro hay menos grupos y más incertidumbre; el promedio global no describe por igual todos los rangos.')
        doc.grafico(fig,slug,titulo,'MAPE promedia errores absolutos; la mediana es menos sensible a un caso extremo. n cuenta publicaciones y g grupos heurísticos.',
                    conclusion,'El asterisco marca menos de 30 grupos; superar ese número no garantiza estabilidad. Se omiten métricas con menos de cinco publicaciones de prueba.')
    doc.parrafo('El sesgo conserva el signo: positivo significa sobreestimación y negativo subestimación. Los signos pueden cancelarse; no reemplaza al MAPE ni sirve como corrección basada en un precio todavía desconocido.')
    doc.partes.append(tabla(['Precio observado USD','Grupos de prueba','Sesgo porcentual medio'],[
        (PRECIOS[n],v['grupos_prueba'],numero(v['metricas']['sesgo_porcentual_medio'])+'%' if v['metricas'] else 'Sin métrica')
        for n,v in segmentos['por_precio'].items()]))
    doc.parrafo('Las tablas completas por barrio y por tipo/precio se conservan en los anexos, con sus tamaños de muestra.')


def graficar_explicaciones(doc,X,shap):
    doc.capitulo('explicaciones','Cómo usa las variables el modelo',
                 'SHAP reparte la diferencia entre el valor base y cada predicción entre las variables. Se verifica que la suma reconstruya la salida y, después de invertir la transformación, los dólares. Las filas se ordenan por influencia absoluta media.')
    medias=np.abs(shap[:,:-1]).mean(axis=0);orden=np.argsort(medias)[-15:][::-1]
    fig,ax=doc.nuevo(12,9);rng=np.random.default_rng(42);cmap=plt.get_cmap('coolwarm')
    for y,i in enumerate(orden):
        colores=np.tile([.5,.5,.5,.55],(len(X),1))
        if X.columns[i] not in COLUMNAS_TEXTO:
            v=pd.to_numeric(X.iloc[:,i],errors='coerce').to_numpy(dtype=float);ok=np.isfinite(v)
            if ok.any():
                bajo,alto=np.quantile(v[ok],[.05,.95]);colores[ok]=cmap(np.clip((v[ok]-bajo)/(alto-bajo),0,1) if alto>bajo else np.full(ok.sum(),.5))
        ax.scatter(shap[:,i],y+rng.uniform(-.28,.28,len(X)),s=10,c=colores,rasterized=True)
    ax.set_yticks(range(len(orden)),[NOMBRES.get(X.columns[i],X.columns[i]) for i in orden]);ax.invert_yaxis();ax.axvline(0,c='black',lw=1)
    ax.set_xlabel('Aporte SHAP en log(precio USD)');cb=fig.colorbar(ScalarMappable(norm=Normalize(0,1),cmap=cmap),ax=ax)
    cb.set_ticks([0,1],labels=['Valor bajo','Valor alto'])
    doc.grafico(fig,'shap_distribucion','Dirección y dispersión de los aportes SHAP','Cada punto es una publicación. A la derecha el aporte aumenta la salida; a la izquierda la reduce. Rojo indica un valor numérico alto y azul bajo.',
                'Las categorías y los faltantes aparecen en gris. Los colores se normalizan dentro de cada variable; no se comparan valores de superficie con valores de antigüedad. Los aportes están en log(precio), no en dólares.',
                'Las variables correlacionadas pueden repartirse la atribución. Un aporte positivo no implica que la variable cause un mayor precio de mercado.')


def resumir_historia(doc,viejo,mejoras):
    doc.capitulo('experimentos','Experimentos y decisiones que conservamos',
                 'Conservamos las conclusiones principales en una tabla. Los resultados históricos tienen poblaciones y protocolos distintos; no forman una única curva de mejora. El detalle permanece en el historial comprimido.')
    ajuste=viejo['comparacion_ajuste']
    doc.partes.append(tabla(['Revisión','Resultado principal','Decisión'],[
        ('Tratamiento del precio','MAPE interno histórico: directo RMSE 26,84%; log RMSE 22,00%; log MAE 21,87%. Cifras redondeadas con 600 árboles.',
         'Mantener log + RMSE: ninguna opción ganó todos los indicadores y la candidata MAE empeoró en prueba.'),
        ('25 configuraciones de árboles',f'MAE histórico: USD {numero(ajuste["prueba_anterior"]["mae_usd"],0)} → {numero(ajuste["prueba_ajustada"]["mae_usd"],0)}. MAPE: {numero(ajuste["prueba_anterior"]["mape_porcentaje"])}% → {numero(ajuste["prueba_ajustada"]["mape_porcentaje"])}%. Mismo test de 675 publicaciones.',
         'Mantener profundidad 6 y 1.400 árboles, elegidos en validación interna. Mejoraron errores en USD, no todas las métricas.'),
        ('Oferta de dos casas linderas',f'MAPE {numero(viejo["prueba"]["mape_porcentaje"])}% → {numero(mejoras["prueba_historica_en_cohorte_comun"]["mape_porcentaje"])}% al pasar de 675 a 674 publicaciones.',
         'Excluir por alcance verificado. Es un cambio de población; las otras predicciones quedaron iguales.'),
        ('Ubicación, superficies y especialistas','Se probaron seis variantes. Ninguna mejoró el MAPE de la base en sus folds internos de selección.',
         'Conservar el modelo general. La CV actual usa otro reparto y no se mezcla con la CV de este experimento.')]))
    doc.parrafo('La revisión geográfica encontró 150 discrepancias entre GPS y texto, 98 ubicaciones recuperables solo por GPS y 170 coordenadas centrales genéricas. Requieren mejorar la fuente; cruzar un punto con límites de barrios no certifica que el punto sea correcto.')


def escribir_glosario(glosario):
    """Actualiza definiciones y conserva la guía editable dentro del TXT."""
    ruta = DESTINO/'00_GLOSARIO.txt'
    guia = ''
    if ruta.exists():
        anterior = ruta.read_text(encoding='utf-8')
        if MARCADOR_GUIA in anterior:
            guia = MARCADOR_GUIA + anterior.split(MARCADOR_GUIA,1)[1].rstrip('\n')
    texto = 'GLOSARIO DE CATBOOST EN SPATIALVALUE\n\n'
    texto += '\n'.join(f'{termino}: {explicacion}' for termino,explicacion in glosario)
    ruta.write_text(texto+guia+'\n',encoding='utf-8')


def anexos(doc,informe,detalle):
    doc.capitulo('limites','Qué falta para mejorar con evidencia',
                 'El modelo actual está limitado por la calidad y cobertura de los datos. Los siguientes trabajos deben compararse en desarrollo y confirmarse en una extracción futura verificada, manteniendo control de republicaciones.')
    doc.partes.append('<ol><li>Separar terreno, total construido y cubierta, con unidades y fuente. Es necesario para revisar las 37 casas sin cambiar de forma inconsistente lo que acepta la API.</li><li>Mejorar barrio y GPS en el origen; distinguir ubicación exacta, aproximada y genérica. No reemplazar automáticamente una dirección confiable por un GPS no verificado.</li><li>Verificar moneda, precio individual y alcance de los anuncios. Solicitar precio explícito o marcarlo desconocido cuando sea a consultar.</li><li>Ampliar cobertura de segmentos caros y categorías con pocos grupos. Agregar información relevante de calidad y estado con una definición consistente.</li><li>Obtener una extracción futura y probar por fecha y por zonas reservadas. Repartir de nuevo este mismo CSV no lo vuelve una validación externa.</li></ol>')
    doc.parrafo('No se informa error respecto de ventas cerradas, deriva futura, precisión por cada barrio completo ni un intervalo individual de tasación: faltan datos o una validación apropiada. Tampoco se realizan pruebas de normalidad como requisito de CatBoost, porque su entrenamiento con árboles no exige esa distribución del precio.')
    doc.capitulo('tablas','Tablas completas y casos para revisar')
    doc.partes.append('<details><summary>Ver barrios, cruces, casos e intervalos</summary>')
    seg=informe['evaluacion_segmentos'];filas=[]
    for n,v in seg['por_barrio'].items():
        m=v['metricas'];filas.append([n.title(),v['n_entrenamiento'],v['n_prueba'],v['grupos_prueba'],numero(m['mape_porcentaje'])+'%' if m else 'Sin métrica',numero(m['percentiles_error_porcentual']['p50'])+'%' if m else '—','Muestra pequeña' if v['muestra_pequena'] else ''])
    doc.parrafo('Cobertura completa por etiqueta de barrio. Las métricas se omiten con menos de cinco publicaciones de prueba; no se reemplazan por cero.')
    doc.partes.append(tabla(['Etiqueta','Entrena','Prueba','Grupos prueba','MAPE','Mediana','Aviso'],filas))
    filas=[]
    for t,rs in seg['por_tipo_y_precio'].items():
        for r,v in rs.items():
            m=v['metricas'];filas.append([t.title(),PRECIOS[r],v['n_prueba'],v['grupos_prueba'],numero(m['mape_porcentaje'])+'%' if m else 'Sin métrica',numero(m['mae_usd'],0) if m else '—'])
    doc.partes.append(tabla(['Tipo','Precio observado USD','Prueba','Grupos','MAPE','MAE USD'],filas))
    doc.parrafo('Un grupo puede aparecer en diferentes segmentos si sus anuncios tienen precios o etiquetas distintos. Sus conteos no siempre son aditivos. Los grupos son heurísticos y pueden incluir unidades diferentes de un mismo edificio o cuadra.')
    errores=detalle.nlargest(10,'error_porcentual');doc.parrafo('Diez errores porcentuales mayores del modelo actual. Son candidatos a revisión; no justifican una eliminación automática.')
    doc.partes.append(tabla(['ID','Tipo','Observado USD','Estimado USD','Error absoluto %'],[[r.id_propiedad,r.tipo_propiedad,numero(r.precio_observado_usd,0),numero(r.precio_predicho_usd,0),numero(r.error_porcentual)] for r in errores.itertuples()]))
    errores=detalle.nlargest(10,'error_absoluto_usd');doc.parrafo('Diez errores en dólares mayores. Pueden ser diferentes de los que dominan el error porcentual.')
    doc.partes.append(tabla(['ID','Observado USD','Estimado USD','Error USD'],[[r.id_propiedad,numero(r.precio_observado_usd,0),numero(r.precio_predicho_usd,0),numero(r.error_absoluto_usd,0)] for r in errores.itertuples()]))
    doc.parrafo('Intervalos bootstrap percentiles con el modelo fijo. No son intervalos de precio individual ni incorporan incertidumbre de volver a entrenar.')
    doc.partes.append(tabla(['Medida','Límite inferior 95%','Límite superior 95%'],[[k,numero(v['inferior_95']),numero(v['superior_95'])] for k,v in informe['bootstrap']['intervalos'].items()]))
    doc.partes.append('</details>')
    doc.capitulo('glosario','Glosario y recorrido de los archivos')
    glosario=[('Entrenamiento','Ejemplos que el modelo usa para aprender.'),('Prueba o test','Ejemplos reservados para medir el resultado; este test ya fue explorado durante el proyecto.'),('Validación cruzada','Varios repartos internos para medir variación sin aprender de la partición que se está validando.'),('Grupo','Publicaciones vinculadas de forma conservadora por dirección o GPS y estructura; no garantiza identidad.'),('Sobreajuste','Aprender detalles del entrenamiento que no ayudan a predecir ejemplos nuevos.'),('Sesgo con signo','Promedio de sobreestimaciones y subestimaciones; los signos pueden cancelarse.'),('MAE',f'Error absoluto medio en prueba: USD {numero(informe["prueba"]["mae_usd"],0)}.'),('MAPE',f'Error porcentual absoluto promedio en prueba: {numero(informe["prueba"]["mape_porcentaje"])}%.'),('RMSE',f'Raíz del error cuadrático medio en prueba: USD {numero(informe["prueba"]["rmse_usd"],0)}. Penaliza más los errores grandes.'),('R²',f'Resultado en prueba: {numero(informe["prueba"]["r2"],3)}. Compara con predecir la media; no es porcentaje de aciertos.'),('SHAP','Reparto de la predicción entre aportes del modelo. No demuestra causalidad.'),('Permutación','Mezclar una característica para medir cuánto depende de ella el modelo fijo.'),('Bootstrap por grupos','Remuestrear grupos completos para explorar la variación de una medida en esta muestra.')]
    doc.partes.append(tabla(['Término','Explicación'],glosario))
    escribir_glosario(glosario)
    archivos=[('modelo.py','Carga, limpieza, variables, CatBoost, grupos y métricas compartidas con la API.'),('evaluar_dataset.py','Entrena y evalúa la configuración vigente; calcula SHAP, curva, bootstrap y permutación.'),('generar_informe.py','Genera este documento y cada gráfico por separado a partir de resultados verificados.'),('test_modelo.py','Pruebas de limpieza, deduplicación, separación por grupos, métricas y reconstrucción SHAP.'),('configuracion_catboost.json','Los parámetros activos; no se cambiaron durante la limpieza.'),('dataset/propiedades.csv','La fuente de trabajo; no se alteró durante esta limpieza.'),('dataset/revision_republicaciones.json','Evidencia e identidad de copias verificadas; participa en la limpieza.'),('auditoria/actual','Métricas, predicciones y matrices necesarias para reproducir el informe sin entrenar.'),('auditoria/historial_catboost.zip','Resultados y código anteriores, revisión de fuentes y respaldo original; archivo de solo lectura.'),('informe/graficos','Una imagen PNG por análisis; cada una puede abrirse o compartirse individualmente.')]
    doc.partes.append(tabla(['Archivo o carpeta','Para qué sirve'],archivos))
    doc.parrafo('Para repetir la evaluación: <code>PYTHONPATH=src/pages/Apis python -m modelo_ia.evaluar_dataset</code>. Para regenerar solo el informe: añadir <code>--solo-informe</code>. Para las pruebas: <code>PYTHONPATH=src/pages/Apis python -m unittest modelo_ia.test_modelo -v</code>. El entrenamiento de la API continúa usando las mismas funciones; no se reinició ni desplegó ningún servicio.')
    doc.capitulo('fuentes','Fuentes y reproducibilidad')
    fuentes=[('CatBoost y aportes SHAP','https://catboost.ai/docs/en/concepts/shap-values'),('Métricas de regresión en scikit learn','https://scikit-learn.org/stable/modules/model_evaluation.html#regression-metrics'),('Permutación e información correlacionada','https://scikit-learn.org/stable/auto_examples/inspection/plot_permutation_importance_multicollinear.html'),('Límites oficiales de barrios BA Data','https://data.buenosaires.gob.ar/dataset/barrios'),('Oferta de dos casas linderas revisada','https://www.zonaprop.com.ar/propiedades/clasificado/veclcain-imponente-casa-con-el-mejor-jardin-de-belgrano-r-60396281.html'),('Ejemplo de casa con varias plantas y cubierta mayor que total','https://www.zonaprop.com.ar/propiedades/clasificado/veclcain-oppel-casa-en-venta-belgrano-r-capital-federal-55391782.html')]
    doc.partes.append('<ul>'+''.join(f'<li><a href="{url}">{titulo}</a></li>' for titulo,url in fuentes)+'</ul>')
    doc.parrafo('Las páginas de anuncios se contrastaron durante las revisiones del 28 de octubre de 2026; el contenido recuperado puede tener un rastreo anterior. Los precios actuales no se usaron para sustituir etiquetas históricas. Las decisiones completas y el respaldo previo a seis eliminaciones están dentro del historial comprimido.')
    doc.partes.append(tabla(['Control','Valor'],list(informe['huellas'].items())+[(f'Versión {k}',v) for k,v in informe['versiones'].items()]))


def escribir_html(doc,informe):
    indice=''.join(f'<li><a href="#{i}">{escape(t)}</a></li>' for i,t in doc.indice)
    indice_graficos='<h3>Gráficos individuales</h3><ol>'+''.join(f'<li><a href="#grafico-{i}">{escape(f["titulo"])}</a></li>' for i,f in enumerate(doc.figuras,1))+'</ol>'
    estilo='''*{box-sizing:border-box}html{scroll-behavior:auto}body{margin:0;background:#f4f6f7;color:#20282e;font:17px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{max-width:1180px;margin:0 auto;padding:56px 48px 28px;background:white}header p{color:#54616c}h1{font-size:38px;line-height:1.2;max-width:800px;color:#000;font-weight:650;letter-spacing:-.7px}h2{font-size:28px;line-height:1.25;color:#000;margin-top:56px;padding-top:12px}h3{font-size:21px;line-height:1.35;color:#000;margin-top:30px}a{color:#125e87;text-underline-offset:3px}nav{position:sticky;top:0;background:#fff;border-bottom:1px solid #d8dee2;padding:10px 24px;z-index:2}nav details{max-width:1080px;margin:auto;max-height:75vh;overflow:auto}[id]{scroll-margin-top:88px}nav ul{columns:2;font-size:15px;padding-left:20px}main{max-width:1180px;margin:0 auto;background:#fff;padding:4px 48px 64px}p{max-width:1000px}img{display:block;width:100%;height:auto;max-height:none;margin:20px 0}.analisis{margin:42px 0 54px}.limite{color:#59646d;font-size:15px}.tabla{overflow-x:auto;margin:24px 0}table{border-collapse:collapse;width:100%;font-size:14px;line-height:1.5}th{background:#e9eff3;text-align:left}td,th{border:1px solid #d9dfe3;padding:10px 12px;vertical-align:middle}tr:nth-child(even){background:#f8fafb}td{overflow-wrap:anywhere}td:first-child,th:first-child{white-space:nowrap}code{font-size:14px;background:#f1f3f5;padding:3px 5px;overflow-wrap:anywhere}footer{max-width:1180px;margin:auto;padding:20px 48px;font-size:14px;color:#5e6a72}@media(max-width:750px){header,main{padding-left:20px;padding-right:20px}h1{font-size:30px}h2{font-size:25px}body{font-size:16px}nav ul{columns:1}}@media print{body{background:#fff;font-size:11pt}header,main{max-width:none;padding:0}nav{display:none}h2{break-before:page}.analisis{break-inside:avoid}img{max-height:19cm;object-fit:contain}table{font-size:9pt}thead{display:table-header-group}footer{padding:0}@page{size:A4;margin:18mm}}'''
    contenido='<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CatBoost en SpatialValue</title><style>'+estilo+'</style></head><body><header><p>SpatialValue · Modelo de tasación · Rama modelo-ia</p><h1>Evolución y evaluación de CatBoost en SpatialValue</h1><p><a href="00_GLOSARIO.txt">Abrir el glosario en texto</a></p><p>Una guía para entender los cambios, leer las métricas y reconocer los límites del modelo. '+str(len(doc.figuras))+' análisis con gráficos individuales.</p></header><nav aria-label="Índice"><details><summary>Índice del documento</summary><ul>'+indice+'</ul><details><summary>Ver todos los gráficos individuales</summary>'+indice_graficos+'</details></details></nav><main>'+''.join(doc.partes)+'</main><footer>Resultados de la evaluación '+escape(informe['fecha_utc'])+'. Gráficos disponibles en la carpeta graficos. No se usan recursos de red para abrir este documento.</footer></body></html>'
    (DESTINO/'INFORME_CATBOOST.html').write_text(contenido,encoding='utf-8')
