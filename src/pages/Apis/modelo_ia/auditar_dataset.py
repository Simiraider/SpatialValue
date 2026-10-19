"""Auditoría descriptiva del JSON local; no limpia ni modifica registros.

Ejecutar desde la raíz: python src/pages/Apis/modelo_ia/auditar_dataset.py
Requiere matplotlib y numpy, únicamente para generar los gráficos.
"""
import json
from collections import Counter
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[4]
SALIDA = Path(__file__).resolve().parent / 'auditoria'


def main():
    datos = json.loads((ROOT / 'dataset_propiedades.json').read_text())
    if not datos:
        raise ValueError('El dataset está vacío')
    SALIDA.mkdir(exist_ok=True)
    n = len(datos)
    plt.rcParams.update({'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False})
    azul, rojo = '#247BA0', '#CA4A43'
    tipos = Counter(str(r.get('tipo_propiedad') or 'Sin dato').strip().casefold() for r in datos)
    barrios = Counter(r.get('barrio_zona') or 'Sin dato' for r in datos)
    campos = ['coordenadas_gps', 'anios_de_antiguedad', 'piso', 'orientacion', 'disposicion', 'superficie_total_m2', 'superficie_cubierta_m2', 'precio_real_usd']
    def faltante(v):
        return v is None or (isinstance(v, str) and v.strip().casefold() in ('', 'no especificada', 'no especificado'))
    ausentes = {c: sum(faltante(r.get(c)) for r in datos) for c in campos}
    fig, axes = plt.subplots(1, 3, figsize=(16, 5.8))
    etiquetas = list(dict.fromkeys(['casa', 'departamento', 'ph'] + list(tipos)))
    valores = [tipos[t] for t in etiquetas]
    bars = axes[0].bar(etiquetas, valores, color=azul)
    axes[0].bar_label(bars, labels=[f'{v} ({v/n:.0%})' for v in valores], padding=4)
    axes[0].set(title='Tipos registrados (no verificados)', ylabel='Cantidad de anuncios', ylim=(0, n * 1.2))
    etiquetas_b, cuentas_b = zip(*barrios.most_common())
    bars = axes[1].barh(etiquetas_b, cuentas_b, color=azul)
    axes[1].bar_label(bars, padding=3)
    axes[1].invert_yaxis()
    axes[1].set(title='Cobertura por barrio', xlabel='Cantidad de anuncios', xlim=(0, max(cuentas_b) + 2))
    nombres = [c.replace('_', ' ') for c in campos]
    bars = axes[2].barh(nombres, [ausentes[c] / n * 100 for c in campos], color=rojo)
    axes[2].bar_label(bars, labels=[f'{ausentes[c]}/{n}' for c in campos], padding=3)
    axes[2].invert_yaxis()
    axes[2].set(title='Datos faltantes o «no especificados»', xlabel='% de registros', xlim=(0, 120))
    fig.suptitle(f'SpatialValue · Cobertura del JSON local · n = {n}', fontsize=16)
    fig.text(.5, .015, 'Las categorías describen lo guardado; no certifican la clasificación. No representa una consulta a Neon.', ha='center', fontsize=10)
    fig.tight_layout(rect=(0, .06, 1, .94))
    fig.savefig(SALIDA / '01_cobertura.png', dpi=160)
    plt.close(fig)

    resumen = {'fuente': 'dataset_propiedades.json', 'registros': n, 'tipos_registrados': dict(tipos), 'barrios': dict(barrios), 'faltantes': ausentes, 'atipicos_iqr': {}}
    fig, axes = plt.subplots(2, 2, figsize=(13, 9))
    for ax, campo, titulo in [(axes[0, 0], 'precio_real_usd', 'Precio registrado como USD'), (axes[0, 1], 'superficie_total_m2', 'Superficie total (m²)')]:
        pares = [(r['id_propiedad'], float(r[campo])) for r in datos if r.get(campo) is not None]
        ids, vals = zip(*pares)
        q1, q3 = np.quantile(vals, [.25, .75], method='linear')
        iqr = q3 - q1
        bajo, alto = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        atipicos = [{'id': i, 'valor': v} for i, v in pares if v < bajo or v > alto]
        resumen['atipicos_iqr'][campo] = {'q1': float(q1), 'q3': float(q3), 'limite_inferior': float(bajo), 'limite_superior': float(alto), 'registros': atipicos}
        ax.boxplot(vals, orientation='horizontal', showfliers=False)
        offsets = np.linspace(-.07, .07, len(vals))
        ax.scatter(vals, 1 + offsets, color=[rojo if v < bajo or v > alto else azul for v in vals], zorder=3)
        for i, v in pares:
            if v < bajo or v > alto:
                ax.annotate(f'{v:,.0f}\n{i}', (v, 1), xytext=(0, 35), textcoords='offset points', ha='center', fontsize=8)
        ax.set(title=titulo, yticks=[], ylim=(.65, 1.6), xlabel='Rojo: fuera de Q1 − 1,5×IQR / Q3 + 1,5×IQR')
    total = np.array([r['superficie_total_m2'] for r in datos], dtype=float)
    banos = np.array([r['banos'] for r in datos], dtype=float)
    cubierta = np.array([r['superficie_cubierta_m2'] for r in datos], dtype=float)
    axes[1, 0].scatter(total, banos, color=rojo)
    axes[1, 0].plot([0, max(total)], [0, max(total)], '--', color='gray', label='Baños = superficie total')
    axes[1, 0].set(title='Indicio de error de extracción', xlabel='Superficie total (m²)', ylabel='Cantidad de baños')
    axes[1, 0].legend()
    axes[1, 1].scatter(total, cubierta, color=azul)
    axes[1, 1].plot(sorted(total), [int(v * .9) for v in sorted(total)], '--', color=rojo, label='Cubierta = parte entera de 0,9 × total')
    axes[1, 1].set(title='Superficie cubierta aparentemente derivada', xlabel='Superficie total (m²)', ylabel='Superficie cubierta (m²)')
    axes[1, 1].legend(fontsize=8)
    resumen['inconsistencias'] = {
        'banos_iguales_a_superficie_total': int(np.sum(banos == total)),
        'dormitorios_mayores_que_ambientes': sum(r['dormitorios'] > r['ambientes'] for r in datos),
        'cubierta_igual_a_90_por_ciento_truncado': int(np.sum(cubierta == np.floor(total * .9))),
        'urls_clasificadas_como_alquiler': sum('/clasificado/al' in r.get('url', '') for r in datos),
        'ids_unicos': len({r.get('id_propiedad') for r in datos}),
    }
    fig.suptitle('SpatialValue · Extremos estadísticos y coherencia de los datos', fontsize=16)
    fig.text(.5, .015, 'IQR señala casos para revisar, no errores confirmados. Los importes corresponden a anuncios de alquiler según sus URLs.', ha='center', fontsize=9)
    fig.tight_layout(rect=(0, .05, 1, .94))
    fig.savefig(SALIDA / '02_atipicos_y_coherencia.png', dpi=160)
    plt.close(fig)
    (SALIDA / 'resumen.json').write_text(json.dumps(resumen, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(resumen, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
