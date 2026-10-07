#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SALIDA = process.argv[2] || '/tmp/fotos-prueba';
const CANTIDAD = Number(process.argv[3]) || 12;
const W = 960, H = 720;

const ROOM = { w: 4.0, d: 3.6, h: 2.7 }; 
const lim = (x0, x1, y0, y1, z0, z1) => ({ x: [x0, x1], y: [y0, y1], z: [z0, z1] });
const LIMITES_ROOM = lim(0, ROOM.w, 0, ROOM.h, 0, ROOM.d);

const PLANOS = [
  { n: [0, 1, 0], p: [0, 0, 0], ejes: ['x', 'z'], tinte: [150, 120, 95], limites: LIMITES_ROOM },   
  { n: [0, -1, 0], p: [0, ROOM.h, 0], ejes: ['x', 'z'], tinte: [235, 235, 230], limites: LIMITES_ROOM }, 
  { n: [0, 0, 1], p: [0, 0, 0], ejes: ['x', 'y'], tinte: [225, 215, 195], limites: LIMITES_ROOM },       
  { n: [0, 0, -1], p: [0, 0, ROOM.d], ejes: ['x', 'y'], tinte: [215, 205, 185], limites: LIMITES_ROOM }, 
  { n: [1, 0, 0], p: [0, 0, 0], ejes: ['z', 'y'], tinte: [200, 220, 225], limites: LIMITES_ROOM },       
  { n: [-1, 0, 0], p: [ROOM.w, 0, 0], ejes: ['z', 'y'], tinte: [220, 200, 210], limites: LIMITES_ROOM }, 
];

const CAJAS = [
  { x: [0.5, 1.6], y: [0, 0.75], z: [1.1, 2.5], tinte: [110, 135, 175] },
  { x: [2.7, 3.5], y: [0, 1.9], z: [2.55, 3.35], tinte: [175, 145, 110] },
];
for (const c of CAJAS) {
  const L = lim(c.x[0], c.x[1], c.y[0], c.y[1], c.z[0], c.z[1]);
  PLANOS.push(
    { n: [0, 1, 0], p: [0, c.y[1], 0], ejes: ['x', 'z'], tinte: c.tinte, limites: L },
    { n: [1, 0, 0], p: [c.x[1], 0, 0], ejes: ['z', 'y'], tinte: c.tinte, limites: L },
    { n: [-1, 0, 0], p: [c.x[0], 0, 0], ejes: ['z', 'y'], tinte: c.tinte, limites: L },
    { n: [0, 0, 1], p: [0, 0, c.z[1]], ejes: ['x', 'y'], tinte: c.tinte, limites: L },
    { n: [0, 0, -1], p: [0, 0, c.z[0]], ejes: ['x', 'y'], tinte: c.tinte, limites: L },
  );
}

function hash2(u, v) {
  let h = (Math.imul(Math.floor(u * 97) | 0, 374761393) ^ Math.imul(Math.floor(v * 97) | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function colorEn(plano, u, v) {
  const cel = 0.35;
  const cu = Math.floor(u / cel), cv = Math.floor(v / cel);
  const semilla = plano.tinte[0] * 1.7 + plano.tinte[2];
  const h1 = hash2(cu * 7.31 + semilla, cv * 9.77 - semilla);     
  const h2 = hash2(cu * 3.71 - semilla, cv * 5.13 + semilla);     
  const h3 = hash2(cu * 9.13 + semilla * 2.1, cv * 2.71 - semilla); 
  const hue = h2 * 6.283;
  const sat = 0.3 + 0.5 * h3;
  const val = 0.4 + 0.55 * h1;
  const k = Math.min(5, Math.floor(hue / 1.047));
  const f = hue / 1.047 - k;
  const p = val * (1 - sat), q = val * (1 - sat * f), t = val * (1 - sat * (1 - f));
  const hsv =
    k === 0 ? [val, t, p] :
    k === 1 ? [q, val, p] :
    k === 2 ? [p, val, t] :
    k === 3 ? [p, q, val] :
    k === 4 ? [t, p, val] : [val, p, q];
  const fraccu = u / cel - cu, fraccv = v / cel - cv;
  const linea = fraccu < 0.08 || fraccv < 0.08 ? 0.5 : 1;
  const ruido = 0.92 + 0.16 * hash2(u * 11.3, v * 7.7);
  const mezcla = 0.55; 
  return [
    Math.min(255, (hsv[0] * 255 * mezcla + plano.tinte[0] * (1 - mezcla)) * linea * ruido),
    Math.min(255, (hsv[1] * 255 * mezcla + plano.tinte[1] * (1 - mezcla)) * linea * ruido),
    Math.min(255, (hsv[2] * 255 * mezcla + plano.tinte[2] * (1 - mezcla)) * linea * ruido),
  ];
}

const FX = 1000, FY = 1000, CX = W / 2, CY = H / 2;
const CENTRO = { x: ROOM.w / 2, y: 1.35, z: ROOM.d / 2 };
const RADIO = 0.95;

function poseCamara(i, total) {
  const a = (i / total) * Math.PI * 2;
  const pos = { x: CENTRO.x + RADIO * Math.cos(a), y: CENTRO.y + 0.15 * Math.sin(a * 2), z: CENTRO.z + RADIO * Math.sin(a) };
  const objetivo = { x: CENTRO.x + 0.55 * Math.cos(a + 0.9), y: CENTRO.y - 0.05, z: CENTRO.z + 0.55 * Math.sin(a + 0.9) };
  return { pos, objetivo };
}

function normalizar(v) {
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function renderFoto(i, total) {
  const { pos, objetivo } = poseCamara(i, total);
  const fwd = normalizar({ x: objetivo.x - pos.x, y: objetivo.y - pos.y, z: objetivo.z - pos.z });
  const right = normalizar({ x: fwd.z, y: 0, z: -fwd.x }); 
  const up = {
    x: right.y * fwd.z - right.z * fwd.y,
    y: right.z * fwd.x - right.x * fwd.z,
    z: right.x * fwd.y - right.y * fwd.x,
  };

  const img = Buffer.alloc(W * H * 3);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const dcx = (px + 0.5 - CX) / FX;
      const dcy = (py + 0.5 - CY) / FY;
      const d = normalizar({
        x: fwd.x + dcx * right.x + dcy * up.x,
        y: fwd.y + dcx * right.y + dcy * up.y,
        z: fwd.z + dcx * right.z + dcy * up.z,
      });

      let mejorT = Infinity, mejorPlano = null, mejorP = null;
      for (const plano of PLANOS) {
        const [nx, ny, nz] = plano.n;
        const dn = d.x * nx + d.y * ny + d.z * nz;
        if (Math.abs(dn) < 1e-9) continue;
        const t = ((plano.p[0] - pos.x) * nx + (plano.p[1] - pos.y) * ny + (plano.p[2] - pos.z) * nz) / dn;
        if (t <= 0.05 || t >= mejorT) continue;
        const px3 = pos.x + t * d.x, py3 = pos.y + t * d.y, pz3 = pos.z + t * d.z;
        const dentro = (v3, eje) => v3 >= plano.limites[eje][0] - 0.03 && v3 <= plano.limites[eje][1] + 0.03;
        if (!dentro(px3, 'x') || !dentro(py3, 'y') || !dentro(pz3, 'z')) continue;
        mejorT = t; mejorPlano = plano; mejorP = { x: px3, y: py3, z: pz3 };
      }

      const off = (py * W + px) * 3;
      let r = 26, g = 30, b = 38; 
      if (mejorPlano) {
        const u = mejorP[mejorPlano.ejes[0]];
        const v = mejorP[mejorPlano.ejes[1]];
        const sombra = Math.max(0.45, 1 - mejorT / 9);
        const [cr, cg, cb] = colorEn(mejorPlano, u, v);
        r = cr * sombra; g = cg * sombra; b = cb * sombra;
      }
      img[off] = Math.round(r); img[off + 1] = Math.round(g); img[off + 2] = Math.round(b);
    }
  }
  return img;
}

const TABLA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(tipo, datos) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([len, cuerpo, crc]);
}
function pngDe(img) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; 
  const crudo = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    crudo[y * (W * 3 + 1)] = 0; 
    img.copy(crudo, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(crudo, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(SALIDA, { recursive: true });
console.log(`Generando ${CANTIDAD} fotos ${W}x${H} en ${SALIDA} …`);
for (let i = 0; i < CANTIDAD; i++) {
  const t0 = Date.now();
  const img = renderFoto(i, CANTIDAD);
  const archivo = path.join(SALIDA, `foto_${String(i + 1).padStart(2, '0')}.png`);
  fs.writeFileSync(archivo, pngDe(img));
  console.log(`  ${path.basename(archivo)} (${Math.round((Date.now() - t0) / 100) / 10}s)`);
}
console.log('Listo. Para probar el worker:');
console.log(`  cd ${SALIDA} && curl -X POST http://localhost:4000/api/jobs \\`);
console.log(`    -F "titulo=Prueba sintetica" -F 'opciones={"calidad":"rapida"}' \\`);
console.log(`    $(for f in foto_*.png; do echo -n "-F \\"fotos=@$f\\" "; done)`);
