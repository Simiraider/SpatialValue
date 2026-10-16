
import fs from 'node:fs';

const ruta = process.argv[2];
if (!ruta) {
  console.error('Uso: node scripts/validar-glb.mjs archivo.glb');
  process.exit(1);
}

const buf = fs.readFileSync(ruta);
const fallas = [];

const magic = buf.readUInt32LE(0);
const version = buf.readUInt32LE(4);
const total = buf.readUInt32LE(8);
if (magic !== 0x46546c67) {
  console.error('[FALLA] Magic invalido (no es un GLB).');
  process.exit(1);
}
if (version !== 2) fallas.push(`version ${version} (esperada 2)`);
if (total !== buf.length) fallas.push(`largo declarado ${total} != real ${buf.length}`);

const jsonLen = buf.readUInt32LE(12);
let json;
try {
  json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
} catch (e) {
  console.error('[FALLA] El chunk JSON no parsea:', e.message);
  process.exit(1);
}
const binStart = 20 + jsonLen + 8;
const binLen = buf.readUInt32LE(20 + jsonLen);
const bin = buf.subarray(binStart, binStart + binLen);

if (!json.buffers?.[0]) fallas.push('sin buffers');
else if (json.buffers[0].byteLength !== binLen) fallas.push('buffer byteLength != chunk BIN');

const TAM = { VEC3: 3, VEC2: 2, SCALAR: 1 };
const COMP = { 5126: 4, 5125: 4, 5123: 2, 5122: 2, 5121: 1, 5120: 1 };

for (const acc of json.accessors || []) {
  const bv = json.bufferViews[acc.bufferView];
  if (!bv) {
    fallas.push('accessor sin bufferView');
    continue;
  }
  const bytes = acc.count * (TAM[acc.type] || 1) * (COMP[acc.componentType] || 1);
  if ((bv.byteOffset || 0) + bytes > bin.length) fallas.push('accessor fuera del binario');
}

const prim = json.meshes?.[0]?.primitives?.[0];
const attrs = prim?.attributes || {};
const tieneIndices = prim?.indices !== undefined;
const esNube = prim?.mode === 0 || !tieneIndices;

const leerAlineado = (Type, offset, count) => {
  const alineado = offset % Type.BYTES_PER_ELEMENT === 0;
  const base = alineado ? bin.buffer : bin.buffer.slice(offset, offset + count * Type.BYTES_PER_ELEMENT);
  return alineado ? new Type(base, offset, count) : new Type(base, 0, count);
};

const posIdx = prim?.attributes?.POSITION;
let nVertices = 0;
let posAcc = null;
if (posIdx != null) {
  posAcc = json.accessors[posIdx];
  nVertices = posAcc.count;
  const posBv = json.bufferViews[posAcc.bufferView];
  const pos = leerAlineado(Float32Array, bin.byteOffset + (posBv.byteOffset || 0) + (posAcc.byteOffset || 0), posAcc.count * 3);
  for (let i = 0; i < pos.length && !fallas.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const v = pos[i + e];
      if (v < posAcc.min[e] - 1e-3 || v > posAcc.max[e] + 1e-3) {
        fallas.push('min/max de POSITION no cuadran con los datos');
        break;
      }
    }
  }
} else {
  fallas.push('primitiva sin atributo POSITION');
}

const idxAcc = tieneIndices ? json.accessors[prim.indices] : null;
if (idxAcc) {
  const idxBv = json.bufferViews[idxAcc.bufferView];
  const base = bin.byteOffset + (idxBv.byteOffset || 0) + (idxAcc.byteOffset || 0);
  const idx =
    idxAcc.componentType === 5125
      ? leerAlineado(Uint32Array, base, idxAcc.count)
      : leerAlineado(Uint16Array, base, idxAcc.count);
  for (let i = 0; i < idx.length; i++) {
    if (idx[i] >= nVertices) {
      fallas.push(`indice ${idx[i]} fuera de rango (${nVertices} vertices)`);
      break;
    }
  }
}

const nTriangulos = esNube || !idxAcc ? 0 : idxAcc.count / 3;

console.log(`\nArchivo: ${ruta}`);
console.log(`   GLB v${version} · ${(buf.length / 1024).toFixed(1)} KB`);
console.log(`   Vertices: ${nVertices} · Triangulos: ${nTriangulos}${esNube ? ' (nube de puntos)' : ''}`);
if (posAcc?.min && posAcc?.max) {
  console.log(`   Bounds X: [${posAcc.min[0].toFixed(2)}, ${posAcc.max[0].toFixed(2)}]`);
  console.log(`   Bounds Z: [${posAcc.min[2].toFixed(2)}, ${posAcc.max[2].toFixed(2)}]`);
}
console.log(`   Attributes: ${Object.keys(attrs).join(', ') || 'ninguno'}`);

if (fallas.length) {
  console.log(`\n[!] ${fallas.length} falla(s):`);
  for (const f of fallas) console.log(`   - ${f}`);
  process.exit(1);
}
console.log('\nOK: estructura, accessors, min/max e indices validos');
