"""Pruebas de limpieza y evaluación; no se conectan a Neon."""
import unittest
import tempfile
import json
from copy import deepcopy
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression
from sklearn.pipeline import make_pipeline
from sklearn.dummy import DummyRegressor
from sklearn.model_selection import train_test_split
from modelo_ia.modelo import (
    limpiar_registros, normalizar_texto, calcular_metricas, evaluar_modelo,
    crear_modelo, _preparar_features, COLUMNAS_TEXTO, COLUMNAS_NUMERICAS,
    cargar_dataset_csv,
    agrupar_inmuebles, dividir_datos,
    firma_republicacion, detectar_republicaciones, eliminar_republicaciones,
    huella_identidad_republicacion,
    evaluar_segmentos,
)
from sklearn.base import clone
from catboost import CatBoostRegressor
from modelo_ia.evaluar_dataset import calcular_shap, bootstrap_grupos


class LimpiezaTest(unittest.TestCase):
    def test_excluye_dos_casas_por_alcance_no_por_precio(self):
        url = 'https://www.zonaprop.com.ar/propiedades/clasificado/veclcain-imponente-casa-con-el-mejor-jardin-de-belgrano-r-60396281.html'
        for precio in (215000,4000000):
            fila = self.registro(id_propiedad='zp-60396281',url=url,precio_usd=precio)
            self.assertEqual(limpiar_registros([fila])[1]['descartados_por_motivo'],{'dos_casas_linderas_fuera_de_alcance':1})
            otra_url = self.registro(id_propiedad='zp-60396281',precio_usd=precio)
            self.assertEqual(len(limpiar_registros([otra_url])[0]),1)

    def registro(self, **cambios):
        return dict({"id_propiedad": "1", "url": "https://www.zonaprop.com.ar/departamento-venta.html",
                     "precio_usd": 100000, "superficie_total_m2": 50,
                     "superficie_cubierta_m2": 40, "ambientes": 1,
                     "dormitorios": 0, "banos": 1, "anios_de_antiguedad": 0,
                     "piso": 0}, **cambios)

    def test_conserva_ceros_y_no_modifica_original(self):
        original = self.registro()
        antes = dict(original)
        filas, _ = limpiar_registros([original])
        self.assertEqual(original, antes)
        for campo in ("dormitorios", "anios_de_antiguedad", "piso"):
            self.assertEqual(filas[0][campo], 0)

    def test_rechaza_alquiler_aunque_el_precio_sea_alto(self):
        filas, _ = limpiar_registros([self.registro(url="https://ejemplo.com/alquiler.html", precio_usd=500000)])
        self.assertEqual(filas, [])

    def test_no_adivina_operacion(self):
        self.assertEqual(limpiar_registros([self.registro(url=None)])[0], [])

    def test_excluye_predicciones(self):
        self.assertEqual(limpiar_registros([self.registro(fuente_precio="ia")])[0], [])

    def test_rechaza_precios_y_superficies_invalidas(self):
        for cambio in ({"precio_usd": float("inf")}, {"precio_usd": -1},
                       {"superficie_cubierta_m2": 60}, {"superficie_total_m2": None}):
            with self.subTest(cambio=cambio):
                self.assertEqual(limpiar_registros([self.registro(**cambio)])[0], [])

    def test_rechaza_extraccion_incoherente(self):
        self.assertEqual(limpiar_registros([self.registro(dormitorios=97, banos=97)])[0], [])

    def test_deduplica_ids_e_informa(self):
        filas, informe = limpiar_registros([self.registro(), self.registro()])
        self.assertEqual(len(filas), 1)
        self.assertEqual(informe["descartados_por_motivo"], {"id_duplicado": 1})

    def test_faltante_no_se_convierte_en_cero(self):
        filas, _ = limpiar_registros([self.registro(anios_de_antiguedad=None)])
        self.assertIsNone(filas[0]["anios_de_antiguedad"])

    def test_normaliza_categorias(self):
        self.assertEqual(normalizar_texto("  NÚÑEZ  "), "nunez")
        self.assertEqual(normalizar_texto("Departamento"), normalizar_texto("departamento"))


class EvaluacionTest(unittest.TestCase):
    def test_bootstrap_por_grupos_es_reproducible_y_no_modifica_datos(self):
        reales=np.array([100.,100.,200.,200.,200.])
        pred=np.array([110.,110.,160.,160.,160.])
        grupos=np.array(['a','a','b','b','b'])
        antes=reales.copy(),pred.copy(),grupos.copy()
        resumen,muestras=bootstrap_grupos(reales,pred,grupos,repeticiones=50)
        resumen2,muestras2=bootstrap_grupos(reales,pred,grupos,repeticiones=50)
        self.assertEqual(resumen,resumen2)
        np.testing.assert_array_equal(muestras,muestras2)
        self.assertEqual(muestras.shape,(50,4))
        # Remuestrear grupos completos permite solo a+a, b+b o a+b.
        self.assertTrue(set(np.round(muestras[:,0],8)) <= {10.,16.,20.})
        for a,b in zip((reales,pred,grupos),antes):np.testing.assert_array_equal(a,b)

    def test_metricas_con_resultado_conocido(self):
        m = calcular_metricas([100, 200], [110, 180])
        self.assertAlmostEqual(m['mae_usd'], 15)
        self.assertAlmostEqual(m['rmse_usd'], np.sqrt(250))
        self.assertAlmostEqual(m['mape_porcentaje'], 10)
        self.assertAlmostEqual(m['r2'], .9)
        self.assertEqual(m['percentiles_error_absoluto_usd']['p100'], 20)

    def test_rechaza_precios_no_positivos(self):
        with self.assertRaises(ValueError):
            calcular_metricas([0, 10], [1, 10])

    def test_r2_indefinido_se_explica_con_null(self):
        self.assertIsNone(calcular_metricas([10, 10], [11, 12])['r2'])

    def test_holdout_no_influye_en_imputacion_ni_cv(self):
        X = pd.DataFrame({'valor': np.arange(40, dtype=float)})
        y = pd.Series(np.arange(40, dtype=float) + 100)
        train, test = train_test_split(np.arange(40), test_size=.2, random_state=42)
        X.loc[test, 'valor'] = 1e10
        modelo, informe, detalle = evaluar_modelo(make_pipeline(SimpleImputer(strategy='median'), LinearRegression()), X, y)
        self.assertAlmostEqual(modelo.named_steps['simpleimputer'].statistics_[0], np.median(X.iloc[train].valor))
        self.assertEqual(set(detalle.indice_fila), set(test))
        y2 = y.copy(); y2.iloc[test] = 1e12
        _, informe2, _ = evaluar_modelo(make_pipeline(SimpleImputer(strategy='median'), LinearRegression()), X, y2)
        self.assertEqual(informe['cross_validation'], informe2['cross_validation'])
        self.assertEqual(len(informe['cross_validation']['folds']), 5)


class SegmentosTest(unittest.TestCase):
    def test_metricas_sesgo_cobertura_y_entradas_sin_mutar(self):
        X = pd.DataFrame({'tipo_propiedad':['Casa']*11,'barrio_zona':['Palermo']*11})
        y = np.full(11,100000.)
        pred = np.array([110000,90000,120000,80000,100000,130000.])
        antes_X,antes_y,antes_pred = X.copy(deep=True),y.copy(),pred.copy()
        informe = evaluar_segmentos(X,y,pred,np.arange(5),np.arange(5,11),grupos=np.arange(11))
        r = informe['por_tipo']['casa']
        self.assertEqual((r['n_entrenamiento'],r['n_prueba'],r['grupos_prueba']),(5,6,6))
        self.assertAlmostEqual(r['metricas']['mape_porcentaje'],15)
        self.assertAlmostEqual(r['metricas']['percentiles_error_porcentual']['p50'],15)
        self.assertAlmostEqual(r['metricas']['sesgo_porcentual_medio'],5)
        self.assertAlmostEqual(r['metricas']['dentro_del_error_porcentual']['hasta_10'],50)
        self.assertAlmostEqual(r['metricas']['dentro_del_error_porcentual']['hasta_20'],100*5/6)
        self.assertAlmostEqual(r['metricas']['dentro_del_error_porcentual']['hasta_30'],100)
        self.assertIsNone(r['metricas']['r2'])
        pd.testing.assert_frame_equal(X,antes_X)
        np.testing.assert_array_equal(y,antes_y)
        np.testing.assert_array_equal(pred,antes_pred)

    def test_limites_de_precios_y_segmentos_sin_cobertura(self):
        X = pd.DataFrame({'tipo_propiedad':['PH']*5+['Casa']*7,
                          'barrio_zona':['Solo entrenamiento']*5+['Solo prueba']*7})
        y = np.array([90000]*5+[1,100000,100000.01,250000,500000,1000000,1000000.01])
        informe = evaluar_segmentos(X,y,y[5:],np.arange(5),np.arange(5,12),grupos=np.arange(12))
        self.assertEqual([v['n_prueba'] for v in informe['por_precio'].values()],[2,2,1,1,1])
        self.assertEqual(sum(v['n_prueba'] for v in informe['por_precio'].values()),7)
        self.assertIsNone(informe['por_tipo']['ph']['metricas'])
        self.assertEqual(informe['por_tipo']['ph']['n_prueba'],0)
        self.assertEqual(informe['por_tipo']['casa']['n_entrenamiento'],0)
        self.assertTrue(any('Sin ejemplos' in a for a in informe['por_tipo']['casa']['advertencias']))
        self.assertIsNone(informe['por_precio']['250k_500k']['metricas'])
        self.assertEqual(informe['por_barrio']['solo entrenamiento']['n_prueba'],0)
        self.assertEqual(informe['por_barrio']['solo prueba']['n_entrenamiento'],0)
        self.assertEqual(informe['por_tipo_y_precio']['casa']['hasta_100k']['n_prueba'],2)

    def test_muchas_publicaciones_no_son_muchos_grupos_y_rechaza_fuga(self):
        X = pd.DataFrame({'tipo_propiedad':['Casa']*35})
        y = 100000+np.arange(35)*1000
        grupos = np.r_[np.arange(5),np.repeat([5,6],15)]
        r = evaluar_segmentos(X,y,y[5:],np.arange(5),np.arange(5,35),grupos=grupos)['por_tipo']['casa']
        self.assertEqual(r['n_prueba'],30)
        self.assertEqual(r['grupos_prueba'],2)
        self.assertTrue(r['muestra_pequena'])
        grupos[-1] = 0
        with self.assertRaisesRegex(ValueError,'grupos'):
            evaluar_segmentos(X,y,y[5:],np.arange(5),np.arange(5,35),grupos=grupos)

    def test_rechaza_desalineacion_y_particiones_solapadas(self):
        X = pd.DataFrame({'tipo_propiedad':['Casa']*10})
        y = np.arange(10)+100000
        with self.assertRaises(ValueError):
            evaluar_segmentos(X,y,y[4:],np.arange(5),np.arange(5,10))
        with self.assertRaises(ValueError):
            evaluar_segmentos(X,y,y[4:],np.arange(5),np.arange(4,10))


class DatasetCSVTest(unittest.TestCase):
    def test_booleanos_precio_observado_y_ceros(self):
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = Path(carpeta) / 'propiedades.csv'
            ruta.write_text('id_propiedad,url,tipo_operacion,tipo_propiedad,barrio_zona,precio_real_usd,precio_estimado_ia_usd,superficie_total_m2,superficie_cubierta_m2,cochera,balcon,anios_de_antiguedad\n1,https://ejemplo.com/venta,venta,Casa,Palermo,200000,999999,80,70,false,true,0\n', encoding='utf-8')
            antes = ruta.read_bytes()
            df = cargar_dataset_csv(ruta)
            self.assertEqual(df.iloc[0].cochera, 0)
            self.assertEqual(df.iloc[0].balcon, 1)
            self.assertEqual(df.iloc[0].precio_usd, 200000)
            self.assertEqual(df.iloc[0].anios_de_antiguedad, 0)
            self.assertTrue(pd.isna(df.iloc[0].piso))
            self.assertEqual(ruta.read_bytes(), antes)

    def test_rechaza_csv_sin_columnas_requeridas(self):
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = Path(carpeta) / 'incompleto.csv'
            ruta.write_text('precio\n100\n')
            with self.assertRaisesRegex(ValueError, 'columnas requeridas'):
                cargar_dataset_csv(ruta)


class CatBoostTest(unittest.TestCase):
    def test_shap_reconstruye_predicciones_con_categorias_y_faltantes(self):
        X = _preparar_features(pd.DataFrame([
            {'tipo_propiedad':'Casa' if i%2 else 'PH','barrio_zona':'Palermo',
             'superficie_total_m2':50+i,'superficie_cubierta_m2':40+i,
             'anios_de_antiguedad':None if i%3 else 0} for i in range(25)]))[COLUMNAS_TEXTO+COLUMNAS_NUMERICAS]
        config={'transformacion_objetivo':'log','parametros':{'iterations':10,'depth':3}}
        modelo=crear_modelo(config).fit(X,100000+np.arange(25)*1000)
        consulta=X.iloc[-4:].copy();consulta['barrio_zona']='categoría nueva'
        antes=modelo.predict(consulta)
        resumen,valores=calcular_shap(modelo,consulta)
        self.assertLess(resumen['error_aditividad'],1e-9)
        self.assertLess(resumen['error_reconstruccion_usd'],1e-6)
        self.assertEqual(valores.shape,(4,len(X.columns)+1))
        np.testing.assert_array_equal(modelo.predict(consulta),antes)


    def test_catboost_categorias_nuevas_faltantes_y_clone(self):
        filas = [{'tipo_propiedad': 'Casa', 'barrio_zona': 'Palermo',
                  'superficie_total_m2': 50 + i, 'superficie_cubierta_m2': 40 + i,
                  'anios_de_antiguedad': None if i % 2 else 0,
                  'cochera': bool(i % 2)} for i in range(25)]
        X = _preparar_features(pd.DataFrame(filas))[COLUMNAS_TEXTO + COLUMNAS_NUMERICAS]
        original = crear_modelo({'transformacion_objetivo':'directo','parametros':{'iterations':10,'depth':3}})
        self.assertIsInstance(original, CatBoostRegressor)
        self.assertFalse(original.get_params()['allow_writing_files'])
        modelo = clone(original).set_params(iterations=10).fit(X, np.arange(25) * 1000 + 100000)
        nuevo = X.iloc[:1].copy()
        nuevo['barrio_zona'] = 'categoria nunca vista'
        self.assertTrue(np.isfinite(modelo.predict(nuevo)).all())
        self.assertEqual(modelo.get_cat_feature_indices(), list(range(len(COLUMNAS_TEXTO))))
        self.assertEqual(X.iloc[0].anios_de_antiguedad, 0)
        self.assertTrue(pd.isna(X.iloc[1].anios_de_antiguedad))

    def test_logaritmo_devuelve_dolares(self):
        config = {'transformacion_objetivo':'log','parametros':{'iterations':10,'depth':3}}
        X = _preparar_features(pd.DataFrame([
            {'tipo_propiedad':'Casa','superficie_total_m2':50+i,'superficie_cubierta_m2':40+i}
            for i in range(25)]))[COLUMNAS_TEXTO+COLUMNAS_NUMERICAS]
        modelo = clone(crear_modelo(config)).fit(X, np.arange(25)*1000+100000)
        np.testing.assert_allclose(modelo.predict(X),np.exp(modelo.regressor_.predict(X)))
        self.assertTrue((modelo.predict(X)>1000).all())


class IntegridadDatosTest(unittest.TestCase):
    def test_no_entrena_emprendimientos_ni_bloques(self):
        base = LimpiezaTest().registro()
        for url in ('https://ejemplo.com/propiedades/emprendimiento/venta.html',
                    'https://ejemplo.com/venta-en-block.html'):
            filas, informe = limpiar_registros([{**base,'url':url}])
            self.assertEqual(filas,[])
        filas,_=limpiar_registros([{**base,'precio_usd':5000000}])
        self.assertEqual(len(filas),1,'No excluir por ser caro')

    def test_categoria_anuncio_corrige_copia(self):
        base=LimpiezaTest().registro(tipo_propiedad='Casa',url='https://www.zonaprop.com.ar/propiedades/clasificado/veclapin-departamento.html')
        filas,informe=limpiar_registros([base])
        self.assertEqual(filas[0]['tipo_propiedad'],'Departamento')
        self.assertEqual(base['tipo_propiedad'],'Casa')

    def test_republicaciones_juntas_sin_usar_precio(self):
        df=pd.DataFrame([
            {'id_propiedad':'a','tipo_propiedad':'Casa','direccion':'Superí al 1600','precio_usd':100},
            {'id_propiedad':'b','tipo_propiedad':'Casa','direccion':'Superi 1600','precio_usd':999999},
        ]+[{'id_propiedad':str(i),'tipo_propiedad':'Casa','direccion':f'Otra {i*100}'} for i in range(1,20)])
        grupos=agrupar_inmuebles(df)
        self.assertEqual(grupos[0],grupos[1])
        train,test=dividir_datos(len(df),grupos)
        self.assertFalse(set(grupos[train]) & set(grupos[test]))

    def test_evaluacion_respeta_grupos(self):
        grupos=np.repeat(np.arange(20),2)
        X=pd.DataFrame({'valor':np.arange(40,dtype=float)})
        y=pd.Series(100000+np.arange(40)*1000)
        _,informe,detalle=evaluar_modelo(make_pipeline(SimpleImputer(),LinearRegression()),X,y,grupos=grupos,random_state=20261028)
        self.assertEqual(informe['grupos']['compartidos'],0)
        train,test=dividir_datos(len(X),grupos,20261028)
        self.assertEqual(set(detalle.indice_fila),set(test))


class RepublicacionesTest(unittest.TestCase):
    def registro(self, identificador, **cambios):
        """Dos avisos pueden compartir estos datos y pertenecer a distintas UF."""
        return dict({
            'id_propiedad': identificador,
            'url': ('https://www.zonaprop.com.ar/propiedades/clasificado/'
                    f'veclapin-departamento-venta-vilela-{identificador[3:]}.html'),
            'direccion': 'Vilela 2630, Saavedra',
            'barrio_zona': 'Saavedra',
            'tipo_propiedad': 'Departamento',
            'coordenadas_gps': '{"lat":-34.5501,"lng":-58.4752}',
            'superficie_total_m2': 50,
            'superficie_cubierta_m2': 43,
            'ambientes': 2,
            'dormitorios': 1,
            'banos': 1,
            'piso': None,
            'fecha_publicacion': '2026-10-01',
            'precio_usd': 146000,
        }, **cambios)

    def caso(self, *filas):
        return {
            'decision': 'mismo_inmueble',
            'ids': [f['id_propiedad'] for f in filas],
            'firma': firma_republicacion(filas[0]),
            'huellas': {f['id_propiedad']: huella_identidad_republicacion(f) for f in filas},
            'evidencia': 'Fixture: identidad contrastada mediante descripción de la unidad.',
        }

    def test_candidato_vilela_sin_revision_no_elimina_unidades(self):
        # Regresión del caso real: el CSV omitía que eran pisos distintos.
        filas = [self.registro('zp-100'), self.registro('zp-200')]
        candidatos = detectar_republicaciones(filas)
        self.assertEqual(len(candidatos), 1)
        conservadas, eliminadas = eliminar_republicaciones(filas, {'casos': []})
        self.assertEqual(conservadas, filas)
        self.assertEqual(eliminadas, [])

    def test_confirmacion_conserva_fecha_reciente_sin_elegir_por_id_o_precio(self):
        for id_reciente, id_anterior in [('zp-100', 'zp-900'), ('zp-900', 'zp-100')]:
            with self.subTest(id_reciente=id_reciente):
                reciente = self.registro(id_reciente, fecha_publicacion='2026-10-20', precio_usd=140000)
                anterior = self.registro(id_anterior, fecha_publicacion='2026-09-01', precio_usd=190000)
                revision = {'casos': [self.caso(reciente, anterior)]}
                for filas in ([anterior, reciente], [reciente, anterior]):
                    conservadas, eliminadas = eliminar_republicaciones(filas, revision)
                    self.assertEqual(conservadas, [reciente])
                    self.assertEqual(eliminadas[0]['id_eliminado'], id_anterior)
                    self.assertEqual(eliminadas[0]['id_conservado'], id_reciente)
                    self.assertEqual(eliminadas[0]['precio_conservado_usd'], 140000)
                    self.assertEqual(eliminadas[0]['precio_eliminado_usd'], 190000)

    def test_misma_fecha_prioriza_completitud_y_luego_id_estable(self):
        incompleta = self.registro('zp-100', estado=None)
        completa = self.registro('zp-900', estado='Usado')
        revision = {'casos': [self.caso(incompleta, completa)]}
        for filas in ([incompleta, completa], [completa, incompleta]):
            self.assertEqual(eliminar_republicaciones(filas, revision)[0], [completa])
        igual_completitud = self.registro('zp-100', estado='Usado')
        revision = {'casos': [self.caso(igual_completitud, completa)]}
        for filas in ([igual_completitud, completa], [completa, igual_completitud]):
            self.assertEqual(eliminar_republicaciones(filas, revision)[0], [igual_completitud])

    def test_cambio_unidad_tras_coma_o_gps_invalida_revision(self):
        original = [self.registro('zp-100', direccion='Vilela 2630, 6 B'),
                    self.registro('zp-200', direccion='Vilela 2630, 6 B')]
        revision = {'casos': [self.caso(*original)]}
        for cambio in ({'direccion': 'Vilela 2630, 8 B'},
                       {'coordenadas_gps': '{"lat":-34.5701,"lng":-58.4752}'}):
            with self.subTest(cambio=cambio):
                modificadas = deepcopy(original)
                modificadas[1].update(cambio)
                self.assertEqual(firma_republicacion(modificadas[1]), firma_republicacion(original[1]))
                self.assertNotEqual(huella_identidad_republicacion(modificadas[1]),
                                    huella_identidad_republicacion(original[1]))
                conservadas, eliminadas = eliminar_republicaciones(modificadas, revision)
                self.assertEqual(conservadas, modificadas)
                self.assertEqual(eliminadas, [])

    def test_rechaza_catalogo_con_grupos_confirmados_solapados(self):
        a, b, c = [self.registro(f'zp-{i}') for i in (100, 200, 300)]
        revision = {'casos': [self.caso(a, b), self.caso(b, c)]}
        with self.assertRaisesRegex(ValueError, 'solapados'):
            eliminar_republicaciones([a, b, c], revision)

    def test_fecha_2500_y_fechas_ausentes_no_producen_overflow(self):
        futura = self.registro('zp-100', fecha_publicacion='2500-01-01')
        for fecha in (None, float('nan'), 'fecha inválida', '2026-10-01'):
            with self.subTest(fecha=fecha):
                otra = self.registro('zp-200', fecha_publicacion=fecha)
                revision = {'casos': [self.caso(futura, otra)]}
                conservadas, eliminadas = eliminar_republicaciones([otra, futura], revision)
                self.assertEqual(conservadas, [futura])
                self.assertEqual(len(eliminadas), 1)

    def test_eliminacion_es_idempotente_y_no_modifica_entradas_ni_revision(self):
        filas = [self.registro('zp-100'), self.registro('zp-200')]
        revision = {'casos': [self.caso(*filas)]}
        antes_filas, antes_revision = deepcopy(filas), deepcopy(revision)
        conservadas, eliminadas = eliminar_republicaciones(filas, revision)
        repetidas, nuevas_eliminadas = eliminar_republicaciones(conservadas, revision)
        self.assertEqual(len(eliminadas), 1)
        self.assertEqual(repetidas, conservadas)
        self.assertEqual(nuevas_eliminadas, [])
        self.assertEqual(filas, antes_filas)
        self.assertEqual(revision, antes_revision)


if __name__ == "__main__":
    unittest.main()
