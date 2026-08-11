#!/usr/bin/env node
/**
 * Validador profundo de un archivo .glb.
 *
 * Verifica:
 *  - Cabecera glTF 2.0 y largo total
 *  - Chunks JSON/BIN y buffer byteLength
 *  - Accesoors dentro de los bufferViews / del binario
 *  - min/max del POSITION contra los datos reales
 *  - Índices dentro del rango de vértices
 *
 * Uso: node scripts/validar-glb.mjs modelo.glb
 */

import fs from 'node:fs';

const ruta = process.argv[2];
if (!ruta) {
  console.error('Uso: node scripts/validar-glb.mjs archivo.glb');
  process.exit(1);
}

const buf = fs.readFileSync(ruta);
const fallas = [];

// ── Cabecera ─────────────────────────────────────────────────────────────────
const magic = buf.readUInt32LE(0);
const version = buf.readUInt32LE(4);
const total = buf.readUInt32LE(8);
if (magic !== 0x46546c67) {
  console.error('❌ Magic inválido (no es un GLB).');
  process.exit(1);
}
if (version !== 2) fallas.push(`versión ${version} (esperada 2)`);
if (total !== buf.length) fallas.push(`largo declarado ${total} != real ${buf.length}`);

// ── JSON + BIN ───────────────────────────────────────────────────────────────
const jsonLen = buf.readUInt32LE(12);
let json;
try {
  json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
} catch (e) {
  console.error('❌ El chunk JSON no parsea:', e.message);
  process.exit(1);
}
const binStart = 20 + jsonLen + 8;
const binLen = buf.readUInt32LE(20 + jsonLen);
const bin = buf.subarray(binStart, binStart + binLen);

if (!json.buffers?.[0]) fallas.push('sin buffers');
else if (json.buffers[0].byteLength !== binLen) fallas.push('buffer byteLength != chunk BIN');

const nVertices = json.accessors?.[0]?.count ?? 0;
const TAM = { VEC3: 3, VEC2: 2, SCALAR: 1 };

for (const acc of json.accessors || []) {
  const bv = json.bufferViews[acc.bufferView];
  if (!bv) {
    fallas.push('accessor sin bufferView');
    continue;
  }
  const comp = acc.componentType === 5126 || acc.componentType === 5125 ? 4 : 2;
  const bytes = acc.count * (TAM[acc.type] || 1) * comp;
  if (bv.byteOffset + bytes > bin.length) fallas.push('accessor fuera del binario');
}

// ── min/max del POSITION contra los datos reales ─────────────────────────────
if (json.accessors?.[0]) {
  const posAcc = json.accessors[0];
  const posBv = json.bufferViews[posAcc.bufferView];
  const pos = new Float32Array(bin.buffer, bin.byteOffset + posBv.byteOffset, posAcc.count * 3);
  for (let i = 0; i < pos.length && !fallas.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const v = pos[i + e];
      if (v < posAcc.min[e] - 1e-3 || v > posAcc.max[e] + 1e-3) {
        fallas.push('min/max de POSITION no cuadran con los datos');
        break;
      }
    }
  }
}

// ── Índices dentro de rango ──────────────────────────────────────────────────
const idxAcc = json.accessors[json.accessors.length - 1];
if (idxAcc) {
  const idxBv = json.bufferViews[idxAcc.bufferView];
  const idx =
    idxAcc.componentType === 5125
      ? new Uint32Array(bin.buffer, bin.byteOffset + idxBv.byteOffset, idxAcc.count)
      : new Uint16Array(bin.buffer, bin.byteOffset + idxBv.byteOffset, idxAcc.count);
  for (let i = 0; i < idx.length; i++) {
    if (idx[i] >= nVertices) {
      fallas.push(`índice ${idx[i]} fuera de rango (${nVertices} vértices)`);
      break;
    }
  }
}

const prim = json.meshes?.[0]?.primitives?.[0];
const attrs = prim?.attributes || {};

console.log(`\n📦 ${ruta}`);
console.log(`   GLB v${version} · ${(buf.length / 1024).toFixed(1)} KB`);
console.log(`   Vértices: ${nVertices} · Triángulos: ${idxAcc ? idxAcc.count / 3 : 0}`);
console.log(`   Bounds X: [${json.accessors[0].min[0].toFixed(2)}, ${json.accessors[0].max[0].toFixed(2)}]`);
console.log(`   Bounds Z: [${json.accessors[0].min[2].toFixed(2)}, ${json.accessors[0].max[2].toFixed(2)}]`);
console.log(`   Attributes: ${Object.keys(attrs).join(', ') || 'ninguno'}`);

if (fallas.length) {
  console.log(`\n❌ ${fallas.length} falla(s):`);
  for (const f of fallas) console.log(`   - ${f}`);
  process.exit(1);
}
console.log('\n✅ GLB válido: estructura, accesoors, min/max e índices OK');
