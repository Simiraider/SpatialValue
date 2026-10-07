import Delaunator from 'delaunator';

export function evaluarNube(posiciones) {
  const nPuntos = Math.floor(posiciones.length / 3);
  if (nPuntos < 2) return { nPuntos, diagonalCaja: 0, densidad: 0 };

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nPuntos; i++) {
    for (let e = 0; e < 3; e++) {
      const v = posiciones[i * 3 + e];
      if (v < min[e]) min[e] = v;
      if (v > max[e]) max[e] = v;
    }
  }
  const dx = max[0] - min[0];
  const dy = max[1] - min[1];
  const dz = max[2] - min[2];
  const diagonalCaja = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

  const densidad = nPuntos / Math.pow(diagonalCaja, 3);

  return { nPuntos, diagonalCaja, densidad };
}

export function triangularNube(posiciones, { factorArista = 3 } = {}) {
  const nVertices = posiciones.length / 3;
  if (nVertices < 3) return [];

  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < nVertices; i++) {
    mx += posiciones[i * 3];
    my += posiciones[i * 3 + 1];
    mz += posiciones[i * 3 + 2];
  }
  mx /= nVertices;
  my /= nVertices;
  mz /= nVertices;

  let cxx = 0, cyy = 0, czz = 0;
  for (let i = 0; i < nVertices; i++) {
    const dx = posiciones[i * 3] - mx;
    const dy = posiciones[i * 3 + 1] - my;
    const dz = posiciones[i * 3 + 2] - mz;
    cxx += dx * dx;
    cyy += dy * dy;
    czz += dz * dz;
  }

  let dropAxis = 0;
  if (cyy < cxx && cyy < czz) dropAxis = 1;
  if (czz < cxx && czz < cyy) dropAxis = 2;

  const uAxis = (dropAxis + 1) % 3;
  const vAxis = (dropAxis + 2) % 3;

  const puntos2D = new Float64Array(nVertices * 2);
  for (let i = 0; i < nVertices; i++) {
    puntos2D[i * 2] = posiciones[i * 3 + uAxis];
    puntos2D[i * 2 + 1] = posiciones[i * 3 + vAxis];
  }

  const delaunay = new Delaunator(puntos2D);
  const triangulos = delaunay.triangles;

  const caras = [];
  let sumLongitud = 0;
  let countAristas = 0;

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
  const maxLongitud = longitudMedia * factorArista;

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

    caras.push([i0, i1, i2]);
  }

  return caras;
}
