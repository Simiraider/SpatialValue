/**
 * Estimaciones de tiempo de procesamiento según cantidad de fotos.
 * Mantener sincronizado con src/lib/gemelo.ts (frontend).
 *
 * Modo fotogrametría real (COLMAP), puntos de referencia de la especificación:
 *   5 fotos  ≈ 2 min   (120 s)
 *   20 fotos ≈ 10 min  (600 s)
 *   50 fotos ≈ 40 min  (2400 s)
 *   100 fotos ≈ 90 min (5400 s)
 * Interpolación lineal por tramos entre esos puntos.
 *
 * Modo simulación: es rápido a propósito (15 s + 2 s por foto, tope 135 s).
 */

const PUNTOS = [
  { fotos: 5, seg: 120 },
  { fotos: 20, seg: 600 },
  { fotos: 50, seg: 2400 },
  { fotos: 100, seg: 5400 },
];

function interpolar(fotos) {
  if (fotos <= PUNTOS[0].fotos) return PUNTOS[0].seg;
  for (let i = 1; i < PUNTOS.length; i++) {
    const a = PUNTOS[i - 1];
    const b = PUNTOS[i];
    if (fotos <= b.fotos) {
      const t = (fotos - a.fotos) / (b.fotos - a.fotos);
      return Math.round(a.seg + t * (b.seg - a.seg));
    }
  }
  const ultimo = PUNTOS[PUNTOS.length - 1];
  const previo = PUNTOS[PUNTOS.length - 2];
  const pendiente = (ultimo.seg - previo.seg) / (ultimo.fotos - previo.fotos);
  return Math.round(ultimo.seg + (fotos - ultimo.fotos) * pendiente);
}

/**
 * @param {number} fotos cantidad de fotos (o frames extraídos)
 * @param {object} [opciones]
 * @param {boolean} [opciones.esVideo] un video se estima equivalente a ~40 fotos
 * @param {string} [opciones.modo] 'colmap' | 'simular'
 * @returns {number} segundos estimados
 */
export function tiempoEstimadoSeg(fotos, { esVideo = false, modo = 'colmap' } = {}) {
  const n = Math.max(1, Number(fotos) || 1);
  const efectivas = esVideo ? Math.max(n, 40) : n;
  if (modo === 'simular') {
    return Math.round(15 + Math.min(efectivas, 60) * 2);
  }
  return interpolar(efectivas);
}
