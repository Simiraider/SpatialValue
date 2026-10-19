"""Reglas de entrenamiento: no escribe en la base ni necesita importar la API."""

import math
import unicodedata
from collections import Counter
from urllib.parse import urlsplit


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
    # La consulta actual no dispone de una columna de operación: se usa la URL.
    # Solo aceptamos una señal explícita; el precio nunca determina la operación.
    operacion = normalizar_texto(registro.get("tipo_operacion"))
    ruta = urlsplit(str(registro.get("url") or "")).path.casefold()
    if operacion == "alquiler" or "alquiler" in ruta or "/clasificado/al" in ruta:
        return False
    return operacion == "venta" or "venta" in ruta or "/clasificado/ve" in ruta


def limpiar_registros(registros):
    """Devuelve copias válidas e informe con el primer motivo de descarte por fila.

    precio_usd sigue dependiendo del contrato de la fuente: esta función no puede
    certificar que el scraper haya interpretado correctamente la moneda original.
    """
    motivos = Counter()
    vistos = set()
    limpios = []
    for original in registros:
        fila = dict(original)
        motivo = None
        precio = numero(fila.get("precio_usd"))
        total = numero(fila.get("superficie_total_m2"))
        cubierta = numero(fila.get("superficie_cubierta_m2"))
        if normalizar_texto(fila.get("fuente_precio")) == "ia":
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
            # No imponemos baños <= ambientes: puede ser legítimo. Un baño por
            # cada menos de 1 m² sí constituye una inconsistencia evidente.
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
            limpios.append(fila)
    return limpios, {"entrada": len(registros), "aceptados": len(limpios), "descartados_por_motivo": dict(motivos)}
