import Delaunator from 'delaunator';

/**
 * Triangula una nube de puntos 3D proyectando al plano principal
 * y aplicando Delaunay 2D. Produce una malla orientada que envuelve
 * la nube sparse de COLMAP.
 * 
 * @param {number[]} posiciones Array plano de coordenadas [x0, y0, z0, x1, y1, z1, ...]
 * @returns {number[][]} Array de caras (cada cara es un array de 3 índices de vértices)
 */
export function triangularNube(posiciones) {
  const nVertices = posiciones.length / 3;
  if (nVertices < 3) return [];

  // 1. Encontrar el centroide
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < nVertices; i++) {
    mx += posiciones[i * 3];
    my += posiciones[i * 3 + 1];
    mz += posiciones[i * 3 + 2];
  }
  mx /= nVertices;
  my /= nVertices;
  mz /= nVertices;

  // 2. Calcular la varianza en los 3 ejes para elegir el plano de proyección
  let cxx = 0, cyy = 0, czz = 0;
  for (let i = 0; i < nVertices; i++) {
    const dx = posiciones[i * 3] - mx;
    const dy = posiciones[i * 3 + 1] - my;
    const dz = posiciones[i * 3 + 2] - mz;
    cxx += dx * dx;
    cyy += dy * dy;
    czz += dz * dz;
  }

  // Descartamos el eje con menor varianza (usualmente representa la "profundidad" de un plano)
  let dropAxis = 0;
  if (cyy < cxx && cyy < czz) dropAxis = 1;
  if (czz < cxx && czz < cyy) dropAxis = 2;

  const uAxis = (dropAxis + 1) % 3;
  const vAxis = (dropAxis + 2) % 3;

  // 3. Proyectar a 2D
  const puntos2D = new Float64Array(nVertices * 2);
  for (let i = 0; i < nVertices; i++) {
    puntos2D[i * 2] = posiciones[i * 3 + uAxis];
    puntos2D[i * 2 + 1] = posiciones[i * 3 + vAxis];
  }

  // 4. Triangulación Delaunay 2D (muy rápido, O(N log N))
  const delaunay = new Delaunator(puntos2D);
  const triangulos = delaunay.triangles;

  // 5. Filtrar triángulos con aristas muy largas (outliers)
  const caras = [];
  let sumLongitud = 0;
  let countAristas = 0;

  // Calculamos la longitud media para filtrar
  for (let i = 0; i < triangulos.length; i += 3) {
    const i0 = triangulos[i];
    const i1 = triangulos[i + 1];
    const i2 = triangulos[i + 2];
    
    const dx1 = posiciones[i1 * 3] - posiciones[i0 * 3];
    const dy1 = posiciones[i1 * 3 + 1] - posiciones[i0 * 3 + 1];
    const dz1 = posiciones[i1 * 3 + 2] - posiciones[i0 * 3 + 2];
    const l1 = Math.sqrt(dx1 * dx1 + dy1 * dy1 + dz1 * dz1);

    const dx2 = posiciones[i2 * 3] - posiciones[i1 * 3];
    const dy2 = posiciones[i2 * 3 + 1] - posiciones[i1 * 3 + 1];
    const dz2 = posiciones[i2 * 3 + 2] - posiciones[i1 * 3 + 2];
    const l2 = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2);

    const dx3 = posiciones[i0 * 3] - posiciones[i2 * 3];
    const dy3 = posiciones[i0 * 3 + 1] - posiciones[i2 * 3 + 1];
    const dz3 = posiciones[i0 * 3 + 2] - posiciones[i2 * 3 + 2];
    const l3 = Math.sqrt(dx3 * dx3 + dy3 * dy3 + dz3 * dz3);

    sumLongitud += l1 + l2 + l3;
    countAristas += 3;
  }

  const longitudMedia = countAristas > 0 ? sumLongitud / countAristas : 0;
  // Umbral: descartamos triángulos que tengan aristas > 3x la longitud media
  const maxLongitud = longitudMedia * 3;

  for (let i = 0; i < triangulos.length; i += 3) {
    const i0 = triangulos[i];
    const i1 = triangulos[i + 1];
    const i2 = triangulos[i + 2];

    const dx1 = posiciones[i1 * 3] - posiciones[i0 * 3];
    const dy1 = posiciones[i1 * 3 + 1] - posiciones[i0 * 3 + 1];
    const dz1 = posiciones[i1 * 3 + 2] - posiciones[i0 * 3 + 2];
    if (dx1 * dx1 + dy1 * dy1 + dz1 * dz1 > maxLongitud * maxLongitud) continue;

    const dx2 = posiciones[i2 * 3] - posiciones[i1 * 3];
    const dy2 = posiciones[i2 * 3 + 1] - posiciones[i1 * 3 + 1];
    const dz2 = posiciones[i2 * 3 + 2] - posiciones[i1 * 3 + 2];
    if (dx2 * dx2 + dy2 * dy2 + dz2 * dz2 > maxLongitud * maxLongitud) continue;

    const dx3 = posiciones[i0 * 3] - posiciones[i2 * 3];
    const dy3 = posiciones[i0 * 3 + 1] - posiciones[i2 * 3 + 1];
    const dz3 = posiciones[i0 * 3 + 2] - posiciones[i2 * 3 + 2];
    if (dx3 * dx3 + dy3 * dy3 + dz3 * dz3 > maxLongitud * maxLongitud) continue;

    // Dependiendo de dropAxis, el winding order de Delaunay (que proyecta en UV) puede requerir invertirse
    // para que las normales apunten "hacia afuera" (acá no nos preocupa tanto porque glTF se renderizará doubleSided)
    caras.push([i0, i1, i2]);
  }

  return caras;
}
