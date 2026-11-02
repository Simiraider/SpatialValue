import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * Genera public/modelos/departamento-demo.glb
 *
 * Es el modelo de demostración que se muestra cuando no hay API key de
 * reconstrucción (o cuando el proveedor falla). Caja de una habitación
 * amueblada, sin texturas: geométrica y de pocos KB, así la pantalla nunca
 * queda en negro.
 */

const cubo = {
  positions: new Float32Array([
    // +X
    0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5,
    // -X
    -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5,
    // +Y
    -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5,
    // -Y
    -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5,
    // +Z
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    // -Z
    0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
  ]),
  normals: new Float32Array([
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
  ]),
  indices: new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11,
    12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
  ]),
};

/** [nombre, tamaño (x,y,z), centro (x,y,z), color hex] */
const objetos = [
  ['Piso', [6, 0.1, 5], [0, -0.05, 0], '#b8b2a6'],
  ['Pared fondo', [6, 3, 0.15], [0, 1.5, -2.5], '#f4f1ea'],
  ['Pared izquierda', [0.15, 3, 5], [-3, 1.5, 0], '#eceae3'],
  ['Mesa', [1.6, 0.75, 0.9], [0.6, 0.375, 0.6], '#9c6b35'],
  ['Sillón', [1.4, 0.7, 0.8], [-1.6, 0.35, 1.4], '#2e6f8e'],
  ['Cama', [2, 0.5, 1.6], [1.4, 0.25, -1.4], '#5e7f6b'],
  ['Alfombra', [2.6, 0.04, 1.8], [-0.6, 0.03, 1.2], '#c96f4a'],
  ['Estante', [0.8, 1.8, 0.4], [-2.5, 0.9, -1.6], '#7d8a97'],
];

const hexARgba = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
};

// ── buffer binario: posiciones, normales e índices del cubo base ─────────────
const posBytes = Buffer.from(cubo.positions.buffer);
const nrmBytes = Buffer.from(cubo.normals.buffer);
const idxBytes = Buffer.from(cubo.indices.buffer);
const relleno = (b) => (4 - (b.length % 4)) % 4;
const bin = Buffer.concat([
  posBytes,
  nrmBytes,
  idxBytes,
  Buffer.alloc(relleno(posBytes) + relleno(nrmBytes) + relleno(idxBytes)),
]);

const vpos = posBytes.length;
const vnrm = vpos + nrmBytes.length;
const vidx = vnrm + nrmBytes.length;

const gltf = {
  asset: { version: '2.0', generator: 'SpatialValue — demo' },
  scene: 0,
  scenes: [{ nodes: objetos.map((_, i) => i) }],
  nodes: objetos.map(([nombre, tam, centro]) => ({
    name: nombre,
    mesh: 0,
    translation: centro,
    scale: tam,
  })),
  meshes: [
    {
      name: 'cubo',
      primitives: objetos.map((o, i) => ({ material: i, attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 })),
    },
  ],
  materials: objetos.map(([, , , color]) => ({
    name: color,
    pbrMetallicRoughness: {
      baseColorFactor: hexARgba(color),
      metallicFactor: 0,
      roughnessFactor: 0.9,
    },
  })),
  buffers: [{ byteLength: bin.length }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: vpos, target: 34962 },
    { buffer: 0, byteOffset: vpos, byteLength: vnrm - vpos, target: 34962 },
    { buffer: 0, byteOffset: vnrm, byteLength: vidx - vnrm, target: 34963 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
    { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
    { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR', min: [0], max: [23] },
  ],
};

const jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
const binPad = (4 - (bin.length % 4)) % 4;
const binChunk = Buffer.concat([bin, Buffer.alloc(binPad)]);

const largoTotal = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
const cabecera = Buffer.alloc(12);
cabecera.writeUInt32LE(0x46546c67, 0); // 'glTF'
cabecera.writeUInt32LE(2, 4);
cabecera.writeUInt32LE(largoTotal, 8);

const cabeceraJson = Buffer.alloc(8);
cabeceraJson.writeUInt32LE(jsonChunk.length, 0);
cabeceraJson.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

const cabeceraBin = Buffer.alloc(8);
cabeceraBin.writeUInt32LE(binChunk.length, 0);
cabeceraBin.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

const glb = Buffer.concat([cabecera, cabeceraJson, jsonChunk, cabeceraBin, binChunk]);
mkdirSync(new URL('../public/modelos/', import.meta.url), { recursive: true });
const destino = new URL('../public/modelos/departamento-demo.glb', import.meta.url);
writeFileSync(destino, glb);
console.log(`GLB demo escrito: ${glb.length} bytes → ${destino.pathname}`);