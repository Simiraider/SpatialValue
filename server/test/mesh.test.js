import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plyAObj, objAGlb } from '../src/services/mesh.js';
import { leerGLB } from '../src/utils/glb.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemelo-mesh-'));

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Un cuadrado de 4 vértices con colores, 2 caras triangulares.
const VERTICES = [
  [0, 0, 0, 255, 0, 0],
  [1, 0, 0, 0, 255, 0],
  [0, 1, 0, 0, 0, 255],
  [1, 1, 1, 255, 255, 255],
];
const CARAS = [
  [0, 1, 2],
  [1, 3, 2],
];

const CABECERA = (v, c) =>
  `ply\nformat ${v.formato} 1.0\nelement vertex ${VERTICES.length}\n` +
  'property float x\nproperty float y\nproperty float z\n' +
  'property uchar red\nproperty uchar green\nproperty uchar blue\n' +
  `element face ${CARAS.length}\nproperty list uchar int vertex_indices\nend_header\n`;

function escribirPLY(ruta, formato) {
  const header = Buffer.from(CABECERA({ formato }), 'latin1');
  if (formato === 'ascii') {
    const lineas = [];
    for (const [x, y, z, r, g, b] of VERTICES) lineas.push(`${x} ${y} ${z} ${r} ${g} ${b}`);
    for (const [a, b, c] of CARAS) lineas.push(`3 ${a} ${b} ${c}`);
    fs.writeFileSync(ruta, Buffer.concat([header, Buffer.from('\n' + lineas.join('\n') + '\n', 'latin1')]));
    return;
  }
  const bytes = Buffer.alloc(VERTICES.length * 15 + CARAS.length * 13);
  let o = 0;
  for (const [x, y, z, r, g, b] of VERTICES) {
    bytes.writeFloatLE(x, o);
    bytes.writeFloatLE(y, o + 4);
    bytes.writeFloatLE(z, o + 8);
    bytes.writeUInt8(r, o + 12);
    bytes.writeUInt8(g, o + 13);
    bytes.writeUInt8(b, o + 14);
    o += 15;
  }
  for (const [a, b, c] of CARAS) {
    bytes.writeUInt8(3, o);
    bytes.writeInt32LE(a, o + 1);
    bytes.writeInt32LE(b, o + 5);
    bytes.writeInt32LE(c, o + 9);
    o += 13;
  }
  fs.writeFileSync(ruta, Buffer.concat([header, bytes]));
}

function comprobarRoundTrip(nombre) {
  const ply = path.join(tmp, `${nombre}.ply`);
  const obj = path.join(tmp, `${nombre}.obj`);
  const glb = path.join(tmp, `${nombre}.glb`);
  escribirPLY(ply, nombre === 'binario' ? 'binary_little_endian' : 'ascii');

  plyAObj(ply, obj);
  const objTexto = fs.readFileSync(obj, 'utf8');
  expect(objTexto.split('\n').filter((l) => l.startsWith('v ')).length).toBe(4);
  expect(objTexto.split('\n').filter((l) => l.startsWith('f ')).length).toBe(2);
  expect(objTexto).toContain('1.0000 0.0000 0.0000'); // color rojo del primer vértice

  const res = objAGlb(obj, glb);
  expect(res.vertices).toBe(4);
  expect(res.triangulos).toBe(2);

  const buf = fs.readFileSync(glb);
  const { json } = leerGLB(buf);
  const posAcc = json.accessors[0];
  expect(posAcc.count).toBe(4);
  expect(posAcc.type).toBe('VEC3');
  expect(json.accessors[json.accessors.length - 1].count).toBe(6); // índices
  const atributos = json.meshes[0].primitives[0].attributes;
  expect(atributos.COLOR_0).toBeDefined();
}

describe('plyAObj + objAGlb (formato COLMAP)', () => {
  it('convierte un PLY binario little-endian correctamente', () => {
    comprobarRoundTrip('binario');
  });

  it('convierte un PLY ascii correctamente', () => {
    comprobarRoundTrip('ascii');
  });

  it('maneja CRLF en la cabecera (Windows)', () => {
    const ply = path.join(tmp, 'crlf.ply');
    const header = CABECERA({ formato: 'binary_little_endian' }).replaceAll('\n', '\r\n');
    const bytes = Buffer.alloc(VERTICES.length * 15 + CARAS.length * 13);
    let o = 0;
    for (const [x, y, z, r, g, b] of VERTICES) {
      bytes.writeFloatLE(x, o);
      bytes.writeFloatLE(y, o + 4);
      bytes.writeFloatLE(z, o + 8);
      bytes.writeUInt8(r, o + 12);
      bytes.writeUInt8(g, o + 13);
      bytes.writeUInt8(b, o + 14);
      o += 15;
    }
    for (const [a, b, c] of CARAS) {
      bytes.writeUInt8(3, o);
      bytes.writeInt32LE(a, o + 1);
      bytes.writeInt32LE(b, o + 5);
      bytes.writeInt32LE(c, o + 9);
      o += 13;
    }
    fs.writeFileSync(ply, Buffer.concat([Buffer.from(header, 'latin1'), bytes]));
    const obj = path.join(tmp, 'crlf.obj');
    const glb = path.join(tmp, 'crlf.glb');
    plyAObj(ply, obj);
    const res = objAGlb(obj, glb);
    expect(res.vertices).toBe(4);
  });

  it('un PLY solo con puntos (nube sin caras) falla con mensaje claro', () => {
    const ply = path.join(tmp, 'puntos.ply');
    const header =
      'ply\nformat binary_little_endian 1.0\nelement vertex 4\n' +
      'property float x\nproperty float y\nproperty float z\nend_header\n';
    const bytes = Buffer.alloc(4 * 12);
    for (let i = 0; i < 4; i++) {
      bytes.writeFloatLE(i, i * 12);
    }
    fs.writeFileSync(ply, Buffer.concat([Buffer.from(header, 'latin1'), bytes]));
    const obj = path.join(tmp, 'puntos.obj');
    const glb = path.join(tmp, 'puntos.glb');
    plyAObj(ply, obj); // no debe tirar: el OBJ queda solo con vértices
    expect(() => objAGlb(obj, glb)).toThrow(/sin caras/);
  });
});
