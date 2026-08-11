import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generarModeloDemo } from '../src/services/simulador.js';
import { leerGLB } from '../src/utils/glb.js';

// Lee los bounds reales del POSITION de un GLB en disco.
function boundsGLB(archivo) {
  const buf = fs.readFileSync(archivo);
  const { json, jsonLength } = leerGLB(buf);
  const bin = buf.subarray(20 + jsonLength + 8);
  const acc = json.accessors[0];
  const bv = json.bufferViews[acc.bufferView];
  const pos = new Float32Array(bin.buffer, bin.byteOffset + bv.byteOffset, acc.count * 3);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      min[e] = Math.min(min[e], pos[i + e]);
      max[e] = Math.max(max[e], pos[i + e]);
    }
  }
  return { min, max };
}


const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemelo-sim-'));

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('generarModeloDemo', () => {
  it('genera un .glb válido y persistido en disco', () => {
    const res = generarModeloDemo({ seed: 'abc123', fotos: 20, outputDir: tmp });
    expect(fs.existsSync(res.archivo)).toBe(true);
    const buf = fs.readFileSync(res.archivo);
    const { json } = leerGLB(buf);
    expect(res.vertices).toBeGreaterThan(500);
    expect(res.triangulos).toBeGreaterThan(500);
    expect(json.asset.version).toBe('2.0');
    expect(json.meshes[0].primitives[0].attributes.POSITION).toBeDefined();
  });

  it('es determinístico para la misma seed', () => {
    const a = generarModeloDemo({ seed: 'seed-x', fotos: 30, outputDir: tmp + '/a' });
    const b = generarModeloDemo({ seed: 'seed-x', fotos: 30, outputDir: tmp + '/b' });
    expect(fs.readFileSync(a.archivo).equals(fs.readFileSync(b.archivo))).toBe(true);
  });

  it('más fotos → más detalle (grilla más fina)', () => {
    const a = generarModeloDemo({ seed: 's1', fotos: 5, outputDir: tmp + '/c' });
    const b = generarModeloDemo({ seed: 's2', fotos: 90, outputDir: tmp + '/d' });
    expect(b.vertices).toBeGreaterThan(a.vertices);
  });

  it('está orientado Y-up: piso en y=0 y volumen hacia arriba (regresión del plano parado)', () => {
    const res = generarModeloDemo({ seed: 'yup', fotos: 22, outputDir: tmp + '/e' });
    const { min, max } = boundsGLB(res.archivo);
    // Y es el eje vertical (glTF): el piso toca y=0 y las paredes suben.
    expect(min[1]).toBeGreaterThanOrEqual(-0.01);
    expect(max[1]).toBeGreaterThan(1);
    // Centrado en el plano del piso.
    expect(min[0]).toBeLessThan(0);
    expect(max[0]).toBeGreaterThan(0);
    expect(min[2]).toBeLessThan(0);
    expect(max[2]).toBeGreaterThan(0);
    // El piso es mucho más ancho que alto (maqueta, no una pared).
    expect(max[0] - min[0]).toBeGreaterThan(3 * (max[1] - min[1]));
  });
});
