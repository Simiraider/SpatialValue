/**
 * Modo SIMULACIÓN: genera un modelo .glb de demostración de forma procedural.
 *
 * Cuando COLMAP no está disponible (plan free, dev, etc.) el worker usa esto
 * para que el flujo completo —subida → progreso → visor 3D— funcione de punta
 * a punta. Produce una "maqueta" de propiedad (piso + habitaciones) con
 * orientación Y-up (convención glTF), determinística (misma seed = mismo
 * resultado) y con más detalle cuantas más fotos se suban.
 */

import fs from 'node:fs';
import path from 'node:path';
import { escribirGLB } from '../utils/glb.js';
import { hashString } from '../utils/id.js';

/** PRNG determinístico (mulberry32). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * Genera el .glb de demostración en outputDir.
 * @param {object} opciones
 * @param {string} opciones.seed  id del trabajo (determinístico)
 * @param {number} opciones.fotos cantidad de fotos (influye en detalle)
 * @returns {{ archivo: string, bytes: number, vertices: number, triangulos: number, simulado: boolean }}
 */
export function generarModeloDemo({ seed, fotos = 20, outputDir }) {
  const rand = mulberry32(hashString(seed || 'demo'));

  // Grilla del piso: más fotos → grilla más fina.
  const n = clamp(Math.round(20 + fotos * 0.35), 24, 48);
  const L = 12; // lado del piso

  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];

  /** Quad con normal explícita (winding libre: el material es doubleSided). */
  const pushQuad = (corners, color, normal) => {
    const base = positions.length / 3;
    for (const v of corners) positions.push(v[0], v[1], v[2]);
    for (let i = 0; i < 4; i++) {
      normals.push(normal[0], normal[1], normal[2]);
      colors.push(color[0], color[1], color[2]);
    }
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  };

  // ── Piso (grilla con leve variación de color, como cerámica/madera) ────────
  const pisoBase = [0.88, 0.80, 0.66];
  const cell = L / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = -L / 2 + i * cell;
      const z0 = -L / 2 + j * cell;
      const jit = (rand() - 0.5) * 0.05;
      pushQuad(
        [[x0, 0, z0], [x0 + cell, 0, z0], [x0 + cell, 0, z0 + cell], [x0, 0, z0 + cell]],
        [pisoBase[0] + jit, pisoBase[1] + jit, pisoBase[2] + jit],
        [0, 1, 0]
      );
    }
  }

  // ── Habitaciones (cajas con paredes + techo, Y-up) ─────────────────────────
  const paleta = [
    [0.96, 0.97, 0.98], // blanco
    [0.55, 0.80, 0.78], // teal claro
    [0.90, 0.71, 0.55], // terracota claro
    [0.72, 0.78, 0.88], // celeste suave
    [0.84, 0.88, 0.78], // salvia
  ];
  const nRooms = 3 + Math.min(4, Math.floor(fotos / 15)); // 3..7 según fotos

  for (let r = 0; r < nRooms; r++) {
    const w = 1.6 + rand() * 2.4; // ancho (x)
    const d = 1.6 + rand() * 2.4; // fondo (z)
    const h = 1.1 + rand() * 1.7; // altura (y)
    const cx = (rand() - 0.5) * (L - 2.6);
    const cz = (rand() - 0.5) * (L - 2.6);
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const z0 = cz - d / 2, z1 = cz + d / 2;
    const color = paleta[Math.floor(rand() * paleta.length)];

    pushQuad(
      [[x0, 0, z0], [x1, 0, z0], [x1, h, z0], [x0, h, z0]], color, [0, 0, -1]  // sur
    );
    pushQuad(
      [[x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1]], color, [0, 0, 1]   // norte
    );
    pushQuad(
      [[x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0]], color, [-1, 0, 0]  // oeste
    );
    pushQuad(
      [[x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, h, z0]], color, [1, 0, 0]   // este
    );
    pushQuad(
      [[x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]], color, [0, 1, 0]   // techo
    );
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const glb = escribirGLB({ positions, normals, colors, indices }, `gemelo-demo-${seed}`);
  const archivo = path.join(outputDir, 'modelo.glb');
  fs.writeFileSync(archivo, glb);

  return {
    archivo,
    bytes: glb.length,
    vertices: positions.length / 3,
    triangulos: indices.length / 6,
    simulado: true,
  };
}
