import unittest

from modelo_ia.limpieza_datos import limpiar_registros, normalizar_texto


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


if __name__ == "__main__":
    unittest.main()
