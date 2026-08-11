import { describe, it, expect } from 'vitest';
import { tiempoEstimadoSeg } from '../src/services/tiempo.js';

describe('tiempoEstimadoSeg (modo colmap)', () => {
  it('respeta los puntos de referencia de la especificación', () => {
    // 5 fotos ≈ 2 min, 20 ≈ 10 min, 50 ≈ 40 min, 100 ≈ 90 min
    const casos = [
      [5, 120],
      [20, 600],
      [50, 2400],
      [100, 5400],
    ];
    for (const [fotos, esperado] of casos) {
      expect(tiempoEstimadoSeg(fotos)).toBeCloseTo(esperado, 0);
    }
  });

  it('es monótona creciente', () => {
    let prev = 0;
    for (let n = 1; n <= 100; n++) {
      const t = tiempoEstimadoSeg(n);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it('en modo simulación es mucho más rápido', () => {
    expect(tiempoEstimadoSeg(50, { modo: 'simular' })).toBeLessThan(150);
    expect(tiempoEstimadoSeg(50, { modo: 'simular' })).toBeLessThan(tiempoEstimadoSeg(50, { modo: 'colmap' }));
  });

  it('un video se estima como ~40 fotos equivalentes', () => {
    const video = tiempoEstimadoSeg(1, { esVideo: true });
    const fotos = tiempoEstimadoSeg(40);
    expect(video).toBe(fotos);
  });
});
