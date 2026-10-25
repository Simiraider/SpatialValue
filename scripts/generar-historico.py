"""
Convierte los XLSX del Mercado Inmobiliario (INDEC CABA sobre base Argenprop)
en un modulo TypeScript con la serie historica por barrio.

Entradas (por defecto se buscan en la carpeta de descargas, se pueden pasar por argv):
  MI_DVP_AX03.xlsx  venta, 2 ambientes usados, USD/m2, trimestral 2006-2026
  MI_DVP_AX04.xlsx  venta, 3 ambientes usados, USD/m2, trimestral 2006-2026
  MI_DVP_AX09.xlsx  venta, 1 ambiente a estrenar, USD/m2, trimestral 2017-2026

Salida:
  src/data/historico-barrios.ts

Uso:
  python scripts/generar-historico.py [--serie 03|04|09] [--salida ruta]
"""

import argparse
import os
import sys
import unicodedata

import pandas as pd

DESCARGAS = r"C:\Users\simon\Downloads"
SERIES = {
    "03": "MI_DVP_AX03.xlsx",
    "04": "MI_DVP_AX04.xlsx",
    "09": "MI_DVP_AX09.xlsx",
}
ETIQUETA_SERIE = {
    "03": "2 ambientes usados",
    "04": "3 ambientes usados",
    "09": "1 ambiente a estrenar",
}

# Valores de referencia que hoy muestra la tarjeta (src/lib/mercado.ts)
REFERENCIA = {
    'puerto madero': 5500, 'recoleta': 3200, 'palermo': 3000, 'belgrano': 2600,
    'nunez': 2400, 'colegiales': 2300, 'caballito': 2200, 'villa crespo': 2200,
    'chacarita': 2200, 'san telmo': 2200, 'almagro': 2100, 'boedo': 1900,
    'saavedra': 1900, 'villa devoto': 1800, 'agronomia': 1800,
    'villa del parque': 1700, 'barracas': 1700, 'paternal': 1700, 'flores': 1600,
    'parque patricios': 1600, 'versalles': 1500, 'liniers': 1400,
    'villa lugano': 1300, 'villa soldati': 1250, 'villa riachuelo': 1250,
    'mataderos': 1450, 'parque avellaneda': 1450, 'velez': 1600,
    'montecastro': 1650, 'monte castro': 1650, 'floresta': 1550,
    'villa real': 1650, 'villa luro': 1550, 'villa santa rita': 1700,
    'villa general mitre': 1750, 'la paternal': 1700, 'villa ortuzar': 2250,
    'parque chas': 1900, 'villa urquiza': 2300, 'coghlan': 2250,
    'villa pueyrredon': 1900, 'parque chacabuco': 1700, 'nueva pompeya': 1300,
    'constitucion': 1500, 'monserrat': 1800, 'la boca': 1450,
    'san nicolas': 2300, 'retiro': 2400, 'san cristobal': 1700,
    'velez sarsfield': 1600,
}


# Nombres de la fuente oficial que no coinciden con nuestra lista de barrios
ALIAS = {
    "boca": "la boca",
    "montserrat": "monserrat",
    "villa gral. mitre": "villa general mitre",
    "villa gral mitre": "villa general mitre",
}


def clave(texto: str) -> str:
    t = unicodedata.normalize("NFD", str(texto)).encode("ascii", "ignore").decode("ascii")
    return " ".join(t.lower().split())


def leer_serie(ruta: str):
    """Devuelve {clave_barrio: [(anio, trimestre, valor), ...]} y el titulo de la hoja."""
    xf = pd.ExcelFile(ruta)
    hoja = xf.sheet_names[0]
    df = xf.parse(hoja, header=None)

    fila_barrio = None
    for i in range(min(8, len(df))):
        if clave(df.iloc[i, 0]) == "barrio":
            fila_barrio = i
            break
    if fila_barrio is None:
        raise SystemExit(f"No encontre la fila 'Barrio' en {ruta}")

    anios = []
    anio_actual = None
    for col in range(1, df.shape[1]):
        celda = df.iloc[fila_barrio, col]
        if isinstance(celda, (int, float)) and not pd.isna(celda):
            anio_actual = int(celda)
        trimestre = df.iloc[fila_barrio + 1, col]
        if isinstance(trimestre, str) and trimestre.strip():
            n = clave(trimestre)[0]  # '1'/'2'/'3'/'4'
            if n in "1234" and anio_actual:
                anios.append((col, anio_actual, int(n)))

    serie = {}
    for fila in range(fila_barrio + 2, len(df)):
        nombre = df.iloc[fila, 0]
        if not isinstance(nombre, str) or not nombre.strip():
            continue
        k = clave(nombre)
        if k in ("total",) or k.startswith(("*", "fuente", "nota", "hasta", "los datos", "la inform", "solo se", "//")):
            continue
        k = ALIAS.get(k, k)
        puntos = []
        for col, anio, trim in anios:
            v = df.iloc[fila, col]
            if isinstance(v, (int, float)) and not pd.isna(v) and v > 0:
                puntos.append((anio, trim, float(v)))
        if puntos:
            serie[k] = puntos

    titulo = str(df.iloc[0, 0])
    return serie, titulo


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--serie", choices=list(SERIES), default="03")
    ap.add_argument("--origen", default=DESCARGAS)
    ap.add_argument("--salida", default=os.path.join("src", "data", "historico-barrios.ts"))
    ap.add_argument("--comparar", action="store_true", help="solo imprime comparacion con la referencia")
    args = ap.parse_args()

    ruta = os.path.join(args.origen, SERIES[args.serie])
    if not os.path.exists(ruta):
        raise SystemExit(f"No existe el archivo: {ruta}")

    serie, titulo = leer_serie(ruta)
    etiqueta = ETIQUETA_SERIE[args.serie]

    # ---------- comparacion contra la referencia de la tarjeta ----------
    diffs = []
    for k, puntos in serie.items():
        if k in REFERENCIA:
            ultimo = puntos[-1][2]
            ref = REFERENCIA[k]
            diffs.append(abs(ultimo - ref) / ref)
    print(f"Serie: venta {etiqueta} ({SERIES[args.serie]})")
    print(f"Barrios con datos: {len(serie)}")
    if diffs:
        print(f"Diff media vs tarjeta: {sum(diffs)/len(diffs)*100:.1f}%  (n={len(diffs)})")
    faltan_ref = [k for k in REFERENCIA if k not in serie]
    print(f"Sin dato oficial (usarian fallback): {len(faltan_ref)} -> {sorted(faltan_ref)}")
    print("Ejemplos (barrio: oficial / tarjeta):")
    for k in ["puerto madero", "recoleta", "palermo", "belgrano", "villa urquiza", "boedo"]:
        if k in serie:
            print(f"  {k}: {serie[k][-1][2]:.0f} / {REFERENCIA.get(k, '-')}")

    if args.comparar:
        return

    # ---------- salida TS ----------
    lineas = []
    lineas.append("// ARCHIVO GENERADO por scripts/generar-historico.py — no editar a mano.")
    lineas.append("// Fuente: Instituto de Estadistica y Censos de la CABA sobre base de datos de Argenprop.")
    lineas.append(f"// Serie: precio de venta USD/m2 de departamentos {etiqueta}, por barrio, trimestral.")
    lineas.append("")
    lineas.append("export type PuntoSerie = { p: string; v: number };")
    lineas.append("/** Serie trimestral por barrio, en orden cronologico. `p` = 'AAAA-Tn' */")
    lineas.append("export type SerieBarrio = PuntoSerie[];")
    lineas.append("")
    lineas.append("export const SERIE_VENTA: Record<string, SerieBarrio> = {")
    for k in sorted(serie):
        pts = ",".join(f'{{p:"{a}-T{t}",v:{round(v,1)}}}' for a, t, v in serie[k])
        lineas.append(f'  "{k}": [{pts}],')
    lineas.append("};")
    lineas.append("")

    ultimo_periodo = max(f"{a}-T{t}" for puntos in serie.values() for a, t, _ in puntos)
    lineas.append(f"export const PERIODO_ACTUAL = '{ultimo_periodo}';")
    lineas.append(f"export const SERIE_ETIQUETA = '{etiqueta}';")
    lineas.append("export const SERIE_FUENTE =")
    lineas.append("  'INDEC CABA (sobre base Argenprop)';")
    lineas.append("")

    salida = args.salida
    os.makedirs(os.path.dirname(salida), exist_ok=True)
    with open(salida, "w", encoding="utf-8") as f:
        f.write("\n".join(lineas))
    print(f"Escrito: {salida} ({os.path.getsize(salida)//1024} KB)")


if __name__ == "__main__":
    sys.exit(main())