import { describe, it, expect } from 'vitest';
import { escribirGLB, leerGLB } from '../src/utils/glb.js';

const mallaBase = () => ({
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  colors: [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1],
  indices: [0, 1, 2, 1, 3, 2],
});

describe('escribirGLB', () => {
  it('produce un GLB con cabecera válida (glTF 2.0)', () => {
    const buf = escribirGLB(mallaBase(), 'test');
    expect(buf.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
    expect(buf.readUInt32LE(4)).toBe(2);
    expect(buf.readUInt32LE(8)).toBe(buf.length);
    const { json } = leerGLB(buf);
    expect(json.asset.version).toBe('2.0');
    expect(json.scenes).toHaveLength(1);
  });

  it('el JSON referencía accesoors dentro del bin', () => {
    const buf = escribirGLB(mallaBase());
    const { json, jsonLength } = leerGLB(buf);
    const binLength = buf.readUInt32LE(20 + jsonLength);
    expect(json.buffers[0].byteLength).toBe(binLength);
    for (const bv of json.bufferViews) {
      expect(bv.byteOffset + bv.byteLength).toBeLessThanOrEqual(json.buffers[0].byteLength);
    }
    for (const acc of json.accessors) {
      expect(acc.count).toBeGreaterThan(0);
    }
    expect(json.accessors[0].min).toBeDefined();
    expect(json.accessors[0].max).toBeDefined();
  });

  it('los datos reales se escriben en los offsets correctos (round-trip)', () => {
    // Regresión del bug de offsets: se acumulaban con .length (elementos) en
    // vez de .byteLength (bytes), corrompiendo NORMAL/COLOR/índices.
    const mesh = mallaBase();
    const buf = escribirGLB(mesh, 'rt');
    const { json, jsonLength } = leerGLB(buf);
    const bin = buf.subarray(20 + jsonLength + 8);

    const leer = (acc, Ctor) => {
      const bv = json.bufferViews[acc.bufferView];
      const n = acc.count * (acc.type === 'VEC3' ? 3 : 1);
      return new Ctor(bin.buffer, bin.byteOffset + bv.byteOffset, n);
    };

    // POSITION (offset 0) y NORMAL (ahora en bytes correctos)
    const pos = leer(json.accessors[0], Float32Array);
    expect(Array.from(pos.subarray(0, 6))).toEqual(mesh.positions.slice(0, 6));
    const norm = leer(json.accessors[1], Float32Array);
    expect(Array.from(norm.subarray(0, 3))).toEqual(mesh.normals.slice(0, 3));

    // COLOR_0
    const colAcc = json.accessors.find((_, i) => json.accessors[i].bufferView === 2);
    const col = leer(colAcc || json.accessors[2], Float32Array);
    expect(Array.from(col.subarray(0, 3))).toEqual(mesh.colors.slice(0, 3));

    // Índices (último accessor), en el offset de bytes correcto
    const idxAcc = json.accessors[json.accessors.length - 1];
    const idx = leer(idxAcc, idxAcc.componentType === 5125 ? Uint32Array : Uint16Array);
    expect(Array.from(idx.subarray(0, 6))).toEqual(mesh.indices.slice(0, 6));
  });

  it('no revienta la pila con mallas grandes (150k vértices, escala COLMAP)', () => {
    const n = 150000;
    const positions = [];
    for (let i = 0; i < n; i++) {
      positions.push((i % 1000) * 0.1, Math.floor(i / 1000) * 0.1, 0);
    }
    const normals = new Array(n * 3).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0));
    const indices = [0, 1, 2, 1, 2, 3];
    const buf = escribirGLB({ positions, normals, indices }, 'grande');
    const { json } = leerGLB(buf);
    expect(json.accessors[0].count).toBe(n);
    expect(json.accessors[0].min.length).toBe(3);
    expect(json.accessors[0].max.length).toBe(3);
  });

  it('usa índices uint32 cuando hay más de 65535 vértices', () => {
    const n = 70000;
    const positions = [];
    for (let i = 0; i < n; i++) positions.push(i, 0, 0);
    const normals = new Array(n * 3).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0));
    const indices = [0, 1, 2, 1, 2, 3];
    const buf = escribirGLB({ positions, normals, indices }, 'grande');
    const { json } = leerGLB(buf);
    const accIndices = json.accessors[json.accessors.length - 1];
    expect(accIndices.componentType).toBe(5125); // UNSIGNED_INT
  });

  it('rechaza mallas inválidas', () => {
    expect(() => escribirGLB({ positions: [1, 2], normals: [], indices: [] })).toThrow();
  });
});
