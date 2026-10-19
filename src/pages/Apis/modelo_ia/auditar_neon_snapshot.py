"""Genera gráficos de una extracción de solo lectura de propiedades de Neon.

Uso: python auditar_neon_snapshot.py /ruta/temporal/snapshot.json
No incluye credenciales ni escribe sobre la base. Requiere numpy y matplotlib.
"""
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np


def main():
    datos = json.loads(Path(sys.argv[1]).read_text())
    salida = Path(__file__).resolve().parent / 'auditoria' / 'neon'
    salida.mkdir(parents=True, exist_ok=True)
    n = len(datos)
    ventas = [r for r in datos if r.get('tipo_operacion') == 'venta']
    tipos = Counter(r.get('tipo_propiedad') or 'Sin dato' for r in datos)
    operaciones = Counter(r.get('tipo_operacion') or 'Sin dato' for r in datos)
    barrios = Counter(r.get('barrio_zona') or 'Sin dato' for r in ventas)
    def falta(v):
        return v is None or (isinstance(v, str) and v.strip().casefold() in ('', 'no especificada', 'no especificado'))
    def num(v):
        try:
            x = float(v)
            return x if np.isfinite(x) else None
        except (TypeError, ValueError):
            return None
    campos = ['coordenadas_gps', 'anios_de_antiguedad', 'piso', 'orientacion', 'disposicion', 'superficie_total_m2', 'superficie_cubierta_m2', 'precio_real_usd']
    faltantes = {c: sum(falta(r.get(c)) for r in ventas) for c in campos}
    plt.rcParams.update({'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False})
    azul, rojo = '#247BA0', '#CA4A43'
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    cats = ['Casa', 'Departamento', 'PH']
    x = np.arange(len(cats)); ancho = .35
    for i, operacion in enumerate(operaciones):
        cuentas = Counter(r.get('tipo_propiedad') for r in datos if r.get('tipo_operacion') == operacion)
        barras = axes[0, 0].bar(x + i * ancho, [cuentas[t] for t in cats], width=ancho, label=operacion)
        axes[0, 0].bar_label(barras, padding=3)
    axes[0, 0].set(xticks=x + ancho / 2, xticklabels=cats, ylabel='Anuncios', title='Tipos por operación registrada')
    axes[0, 0].legend()
    bs = axes[0, 1].bar(list(operaciones), list(operaciones.values()), color=azul)
    axes[0, 1].bar_label(bs, padding=3)
    axes[0, 1].set(title='Operaciones: valores tal como están en Neon', ylabel='Anuncios', ylim=(0, max(operaciones.values()) * 1.15))
    top = barrios.most_common(10)
    bs = axes[1, 0].barh([p[0] for p in top], [p[1] for p in top], color=azul)
    axes[1, 0].bar_label(bs, padding=3)
    axes[1, 0].invert_yaxis()
    axes[1, 0].set(title=f'Ventas: 10 barrios más frecuentes de {len(barrios)} etiquetas', xlabel='Anuncios')
    bs = axes[1, 1].barh([c.replace('_', ' ') for c in campos], [faltantes[c]/len(ventas)*100 for c in campos], color=rojo)
    axes[1, 1].bar_label(bs, labels=[f'{faltantes[c]}/{len(ventas)}' for c in campos], padding=3)
    axes[1, 1].invert_yaxis()
    axes[1, 1].set(title='Ventas: faltantes o «no especificados»', xlabel='% de anuncios', xlim=(0, 125))
    fig.suptitle(f'Neon · propiedades: {n:,} registros · {len(ventas):,} etiquetados venta', fontsize=16)
    fig.text(.5, .015, '«compra» se conserva como etiqueta original; no se presupone que signifique alquiler. Categorías sin verificar contra anuncios.', ha='center', fontsize=9)
    fig.tight_layout(rect=(0, .05, 1, .95)); fig.savefig(salida/'01_cobertura_neon.png', dpi=160); plt.close(fig)

    resumen = {'fuente': 'Neon, tabla public.propiedades, consulta de solo lectura', 'consulta_utc': datetime.now(timezone.utc).isoformat(), 'registros': n, 'operaciones': dict(operaciones), 'tipos': dict(tipos), 'tipos_por_operacion': {op: dict(Counter(r.get('tipo_propiedad') for r in datos if r.get('tipo_operacion') == op)) for op in operaciones}, 'barrios_venta': dict(barrios), 'faltantes_venta': faltantes, 'atipicos_iqr_venta_por_tipo': {}}
    fig, axes = plt.subplots(2, 3, figsize=(16, 9))
    for fila, (campo, etiqueta) in enumerate([('precio_real_usd', 'Precio registrado (USD)'), ('superficie_total_m2', 'Superficie total (m²)')]):
        for col, tipo in enumerate(cats):
            ax = axes[fila, col]
            pares = [(r['id_propiedad'], num(r.get(campo))) for r in ventas if r.get('tipo_propiedad') == tipo]
            pares = [(i, v) for i, v in pares if v is not None and v > 0]
            ax.set(title=f'{tipo} · n = {len(pares)}', xlabel=etiqueta)
            if not pares:
                ax.text(.5, .5, 'Sin valores positivos', transform=ax.transAxes, ha='center'); continue
            ids, vals = zip(*pares)
            if len(vals) < 4:
                ax.scatter(vals, np.ones(len(vals)), color=azul)
                ax.set(yticks=[])
                ax.text(.5, .8, 'Muestra insuficiente para IQR', transform=ax.transAxes, ha='center', fontsize=9)
                resumen['atipicos_iqr_venta_por_tipo'][f'{tipo}:{campo}'] = {'n': len(vals), 'estado': 'muestra insuficiente'}
                continue
            q1, q3 = np.quantile(vals, [.25, .75]); iqr=q3-q1
            bajo, alto = q1-1.5*iqr, q3+1.5*iqr
            extremos = [{'id': i, 'valor': v} for i, v in pares if v < bajo or v > alto]
            ax.boxplot(vals, orientation='horizontal', showfliers=False)
            ax.scatter(vals, np.random.default_rng(42).uniform(.94, 1.06, len(vals)), s=12, alpha=.5, color=[rojo if v<bajo or v>alto else azul for v in vals])
            ax.set(yticks=[])
            ax.set_xscale('log')
            ax.set_xlabel(etiqueta + ' · escala logarítmica')
            ax.text(.02, .88, f'{len(extremos)} señalados ({len(extremos)/len(vals):.1%})', transform=ax.transAxes, fontsize=9)
            resumen['atipicos_iqr_venta_por_tipo'][f'{tipo}:{campo}'] = {'n': len(vals), 'q1':float(q1), 'q3':float(q3), 'limite_inferior':float(bajo), 'limite_superior':float(alto), 'cantidad':len(extremos), 'registros':extremos}
    fig.suptitle('Neon · Valores extremos entre ventas, separados por tipo registrado', fontsize=16)
    fig.text(.5,.015,'Rojo: fuera de Q1 − 1,5×IQR / Q3 + 1,5×IQR. Se excluyen faltantes y valores no positivos de estos gráficos. Un extremo no es un error confirmado.',ha='center',fontsize=9)
    fig.tight_layout(rect=(0,.05,1,.95)); fig.savefig(salida/'02_atipicos_neon.png',dpi=160); plt.close(fig)

    grupos = {'todos': datos, 'venta': ventas}
    resumen['coherencia'] = {}
    for nombre, registros in grupos.items():
        def ambos(r, a, b): return num(r.get(a)) is not None and num(r.get(b)) is not None
        resumen['coherencia'][nombre] = {
            'registros':len(registros),
            'precio_ausente_o_no_positivo':sum(num(r.get('precio_real_usd')) is None or num(r.get('precio_real_usd')) <= 0 for r in registros),
            'superficie_total_ausente_o_no_positiva':sum(num(r.get('superficie_total_m2')) is None or num(r.get('superficie_total_m2')) <= 0 for r in registros),
            'superficie_cubierta_ausente_o_no_positiva':sum(num(r.get('superficie_cubierta_m2')) is None or num(r.get('superficie_cubierta_m2')) <= 0 for r in registros),
            'cubierta_mayor_total':sum(ambos(r,'superficie_cubierta_m2','superficie_total_m2') and r['superficie_cubierta_m2']>r['superficie_total_m2'] for r in registros),
            'dormitorios_mayores_ambientes':sum(ambos(r,'dormitorios','ambientes') and r['dormitorios']>r['ambientes'] for r in registros),
            'banos_iguales_a_superficie_total_positiva':sum(ambos(r,'banos','superficie_total_m2') and r['banos']==r['superficie_total_m2'] and r['superficie_total_m2']>0 for r in registros),
            'ids_unicos':len({r['id_propiedad'] for r in registros}),
        }
    fig, ax = plt.subplots(figsize=(12, 5))
    coherencia=resumen['coherencia']['venta']
    labels=['Precio ausente o ≤ 0','Total ausente o ≤ 0','Cubierta ausente o ≤ 0','Cubierta > total','Dormitorios > ambientes','Baños = total m² (> 0)']
    claves=list(coherencia)[1:-1]
    bs=ax.barh(labels,[coherencia[k] for k in claves],color=rojo)
    ax.bar_label(bs,padding=3); ax.invert_yaxis(); ax.set(xlabel='Cantidad de anuncios (reglas pueden superponerse)',title=f'Neon · Comprobaciones de calidad sobre {len(ventas)} ventas')
    ax.set_xlim(0,max([coherencia[k] for k in claves]+[1])*1.2)
    fig.tight_layout();fig.savefig(salida/'03_coherencia_neon.png',dpi=160);plt.close(fig)
    # Cuenta descartes con las reglas actuales, sin entrenar ni modificar la fuente.
    from limpieza_datos import limpiar_registros
    _, informe=limpiar_registros([{**r,'precio_usd':r.get('precio_real_usd')} for r in datos])
    resumen['limpieza_simulada']=informe
    (salida/'resumen_neon.json').write_text(json.dumps(resumen,ensure_ascii=False,indent=2)+'\n')
    compacto={k:v for k,v in resumen.items() if k not in ('barrios_venta','atipicos_iqr_venta_por_tipo')}
    compacto['top_barrios_venta']=barrios.most_common(10)
    compacto['atipicos']={k:{kk:vv for kk,vv in v.items() if kk!='registros'} for k,v in resumen['atipicos_iqr_venta_por_tipo'].items()}
    print(json.dumps(compacto,ensure_ascii=False,indent=2))


if __name__ == '__main__':
    main()
