/**
 * Conversión de mallas a .glb sin dependencias:
 *   PLY (salida de COLMAP) → OBJ → GLB.
 * Soporta PLY ASCII y binario little-endian (los dos formatos que emite COLMAP).
 *
 * Nota: el offset de datos se calcula con buffer.indexOf('end_header') y NO con
 * el índice de línea (un bug histórico: los índices de línea no son offsets de
 * bytes). Cubierto por server/test/mesh.test.js.
 */

import fs from 'node:fs';
import path from 'node:path';
import { escribirGLB } from '../utils/glb.js';
import { logger } from '../utils/logger.js';

// ── PLY → OBJ ────────────────────────────────────────────────────────────────

function parsearCabeceraPLY(texto) {
  const lineas = texto.split(/\r?\n/);
  if (lineas[0].trim() !== 'ply') throw new Error('No es un archivo PLY válido');
  let formato = null;
  const elementos = []; // { nombre, cantidad, propiedades: [{nombre, tipo}] }
  let actual = null;
  let i = 1;
  for (; i < lineas.length; i++) {
    const l = lineas[i].trim();
    if (l === 'end_header') break;
    const [k, ...resto] = l.split(/\s+/);
    if (k === 'format') {
      formato = resto[0];
    } else if (k === 'element') {
      actual = { nombre: resto[0], cantidad: Number(resto[1]), propiedades: [] };
      elementos.push(actual);
    } else if (k === 'property') {
      if (resto[0] === 'list') {
        actual.propiedades.push({ tipo: `list:${resto[1]}:${resto[2]}`, nombre: resto[3] });
      } else {
        actual.propiedades.push({ tipo: resto[0], nombre: resto[1] });
      }
    }
  }
  return { formato, elementos };
}

const TAMANOS = { char: 1, uchar: 1, short: 2, ushort: 2, int: 4, uint: 4, float: 4, double: 8 };

/**
 * Convierte un PLY a OBJ (con colores de vértice al estilo Maya: "v x y z r g b").
 * @param {string} plyPath
 * @param {string} objPath
 */
export function plyAObj(plyPath, objPath) {
  const buffer = fs.readFileSync(plyPath);
  const cabecera = parsearCabeceraPLY(
    buffer.subarray(0, Math.min(buffer.length, 65536)).toString('latin1')
  );
  const vertices = cabecera.elementos.find((e) => e.nombre === 'vertex');
  const caras = cabecera.elementos.find((e) => e.nombre === 'face');
  if (!vertices) throw new Error('PLY sin elemento "vertex"');

  // Byte donde arrancan los datos: justo después de la línea "end_header"
  // (robusto a LF y CRLF, a diferencia de contar líneas).
  const idxEnd = buffer.indexOf(Buffer.from('end_header'));
  if (idxEnd === -1) throw new Error('PLY sin end_header');
  let bytesDeDatos = idxEnd + Buffer.byteLength('end_header');
  if (buffer[bytesDeDatos] === 0x0d) bytesDeDatos++;
  if (buffer[bytesDeDatos] === 0x0a) bytesDeDatos++;

  const lineas = [];

  const leer = (offset, tipo) => {
    const tam = TAMANOS[tipo];
    if (tipo === 'float') return buffer.readFloatLE(offset);
    if (tipo === 'double') return buffer.readDoubleLE(offset);
    if (tipo === 'char' || tipo === 'int') return buffer.readIntLE(offset, tam);
    if (tipo === 'short') return buffer.readInt16LE(offset);
    if (tipo === 'uchar' || tipo === 'uint' || tipo === 'ushort') return buffer.readUIntLE(offset, tam);
    throw new Error(`Tipo PLY no soportado: ${tipo}`);
  };

  const propIndex = (nombre) => vertices.propiedades.findIndex((p) => p.nombre === nombre);
  const ix = propIndex('x'), iy = propIndex('y'), iz = propIndex('z');
  const ir = propIndex('red'), ig = propIndex('green'), ib = propIndex('blue');

  if (cabecera.formato === 'ascii') {
    const resto = buffer
      .subarray(bytesDeDatos)
      .toString('latin1')
      .split(/\r?\n/)
      .filter(Boolean);
    let k = 0;
    for (let v = 0; v < vertices.cantidad; v++) {
      const cols = resto[k++].trim().split(/\s+/).map(Number);
      const x = cols[ix], y = cols[iy], z = cols[iz];
      const r = ir >= 0 ? cols[ir] / 255 : 0.6;
      const g = ig >= 0 ? cols[ig] / 255 : 0.6;
      const b = ib >= 0 ? cols[ib] / 255 : 0.6;
      lineas.push(`v ${x} ${y} ${z} ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}`);
    }
    for (let f = 0; f < (caras?.cantidad ?? 0); f++) {
      const cols = resto[k++].trim().split(/\s+/).map(Number);
      const n = cols[0];
      for (let t = 1; t + 2 <= n; t++) {
        lineas.push(`f ${cols[t] + 1} ${cols[t + 1] + 1} ${cols[t + 2] + 1}`);
      }
    }
  } else if (cabecera.formato === 'binary_little_endian') {
    let offset = bytesDeDatos;
    for (let v = 0; v < vertices.cantidad; v++) {
      const valores = vertices.propiedades.map((p) => {
        const val = leer(offset, p.tipo);
        offset += TAMANOS[p.tipo];
        return val;
      });
      const x = valores[ix], y = valores[iy], z = valores[iz];
      const r = ir >= 0 ? valores[ir] / 255 : 0.6;
      const g = ig >= 0 ? valores[ig] / 255 : 0.6;
      const b = ib >= 0 ? valores[ib] / 255 : 0.6;
      lineas.push(`v ${x} ${y} ${z} ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}`);
    }
    if (caras) {
      const listProp = caras.propiedades.find((p) => p.tipo.startsWith('list'));
      const [, tipoConteo, tipoIndice] = listProp ? listProp.tipo.split(':') : [];
      for (let f = 0; f < caras.cantidad; f++) {
        const n = leer(offset, tipoConteo);
        offset += TAMANOS[tipoConteo];
        const indices = [];
        for (let t = 0; t < n; t++) {
          indices.push(leer(offset, tipoIndice));
          offset += TAMANOS[tipoIndice];
        }
        for (let t = 1; t + 2 <= n; t++) {
          lineas.push(`f ${indices[t] + 1} ${indices[t + 1] + 1} ${indices[t + 2] + 1}`);
        }
      }
    }
  } else {
    throw new Error(`Formato PLY no soportado: ${cabecera.formato}`);
  }

  fs.writeFileSync(objPath, lineas.join('\n'), 'utf8');
  return objPath;
}

// ── OBJ → GLB ────────────────────────────────────────────────────────────────

function normalizar(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Convierte un OBJ (vértices con o sin color, caras triangulares) a GLB.
 * @param {string} objPath
 * @param {string} glbPath
 */
export function objAGlb(objPath, glbPath) {
  const posiciones = [];
  const colores = [];
  const indices = [];
  const normalesPorVertice = [];
  const caras = [];

  const contenido = fs.readFileSync(objPath, 'utf8');
  for (const lineaRaw of contenido.split(/\r?\n/)) {
    const linea = lineaRaw.trim();
    if (!linea || linea.startsWith('#')) continue;
    const [tipo, ...resto] = linea.split(/\s+/);
    if (tipo === 'v') {
      const nums = resto.map(Number);
      posiciones.push(nums[0], nums[1], nums[2]);
      if (nums.length >= 6) {
        colores.push(nums[3], nums[4], nums[5]);
      }
    } else if (tipo === 'vn') {
      normalesPorVertice.push(resto.map(Number));
    } else if (tipo === 'f') {
      const refs = resto.map((r) => parseInt(r.split('/')[0], 10));
      if (refs.length < 3) continue;
      for (let t = 1; t + 2 <= refs.length; t++) {
        caras.push([refs[0] - 1, refs[t] - 1, refs[t + 1] - 1]);
      }
    }
    // 'p' (puntos) y 'l' (líneas) se ignoran: model-viewer renderiza mallas.
  }

  if (posiciones.length === 0) throw new Error('OBJ sin vértices');
  if (caras.length === 0) throw new Error('OBJ sin caras (el modelo es solo una nube de puntos)');

  const nVertices = posiciones.length / 3;
  for (const [a, b, c] of caras) {
    if (a < 0 || b < 0 || c < 0 || a >= nVertices || b >= nVertices || c >= nVertices) continue;
    indices.push(a, b, c);
  }
  if (indices.length === 0) throw new Error('OBJ sin caras válidas');

  // Si no hay normales declaradas, se calculan como promedio de las caras.
  let normales;
  if (normalesPorVertice.length === nVertices) {
    normales = normalesPorVertice.flat();
  } else {
    const acc = new Float32Array(nVertices * 3);
    for (let k = 0; k < indices.length; k += 3) {
      const i0 = indices[k], i1 = indices[k + 1], i2 = indices[k + 2];
      const ax = posiciones[i1 * 3] - posiciones[i0 * 3];
      const ay = posiciones[i1 * 3 + 1] - posiciones[i0 * 3 + 1];
      const az = posiciones[i1 * 3 + 2] - posiciones[i0 * 3 + 2];
      const bx = posiciones[i2 * 3] - posiciones[i0 * 3];
      const by = posiciones[i2 * 3 + 1] - posiciones[i0 * 3 + 1];
      const bz = posiciones[i2 * 3 + 2] - posiciones[i0 * 3 + 2];
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      for (const idx of [i0, i1, i2]) {
        acc[idx * 3] += nx;
        acc[idx * 3 + 1] += ny;
        acc[idx * 3 + 2] += nz;
      }
    }
    normales = Array.from(acc);
    for (let i = 0; i < normales.length; i += 3) {
      const [nx, ny, nz] = normalizar([normales[i], normales[i + 1], normales[i + 2]]);
      normales[i] = nx; normales[i + 1] = ny; normales[i + 2] = nz;
    }
  }

  const glb = escribirGLB(
    { positions: posiciones, normals: normales, colors: colores.length ? colores : undefined, indices },
    path.basename(glbPath, '.glb')
  );
  fs.writeFileSync(glbPath, glb);
  return { archivo: glbPath, bytes: glb.length, vertices: nVertices, triangulos: indices.length / 3 };
}

/** Convierte la malla de salida de COLMAP (PLY) a un .glb. */
export function convertirMalla(mallaPly, glbPath) {
  const tmpObj = glbPath.replace(/\.glb$/i, '.obj');
  plyAObj(mallaPly, tmpObj);
  const resultado = objAGlb(tmpObj, glbPath);
  try {
    fs.unlinkSync(tmpObj); // el OBJ es intermedio
  } catch {
    logger.warn('[mesh] no se pudo borrar el OBJ temporal');
  }
  return resultado;
}
