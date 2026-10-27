"""Pruebas de limpieza y evaluación; no se conectan a Neon."""
import unittest
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import train_test_split
from modelo_ia.modelo import limpiar_registros, normalizar_texto, calcular_metricas, evaluar_modelo


class LimpiezaTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
