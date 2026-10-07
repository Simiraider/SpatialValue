import { describe, it, expect } from 'vitest';
import { evaluarNube, triangularNube } from '../src/services/triangular.js';

describe('evaluarNube', () => {
  it('cuenta puntos y mide densidad baja en una nube vacía/dispersa', () => {
    const r = evaluarNube([0, 0, 0, 1000, 0, 0, 0, 1000, 0]);
    expect(r.nPuntos).toBe(3);
    expect(r.densidad).toBeLessThan(0.0008);
  });

  it('detecta una nube densa', () => {
    const puntos = [];
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) {
        for (let z = 0; z < 12; z++) puntos.push(x, y, z);
      }
    }
    const r = evaluarNube(puntos);
    expect(r.nPuntos).toBe(12 * 12 * 12);
    expect(r.densidad).toBeGreaterThan(0.0008);
  });

  it('no revienta con nubes de menos de 2 puntos', () => {
    expect(evaluarNube([]).nPuntos).toBe(0);
    expect(evaluarNube([1, 2, 3]).nPuntos).toBe(1);
  });
});

describe('triangularNube', () => {
  it('devuelve [] con menos de 3 puntos', () => {
    expect(triangularNube([0, 0, 0, 1, 0, 0])).toEqual([]);
  });

  it('triangula un plano con puntos suficientes', () => {
    const puntos = [];
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) puntos.push(x, y, 0);
    }
    const caras = triangularNube(puntos);
    expect(caras.length).toBeGreaterThan(0);
    for (const c of caras) {
      expect(c).toHaveLength(3);
      expect(c[0]).toBeLessThan(25);
    }
  });
});
