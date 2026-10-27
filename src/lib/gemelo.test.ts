import { describe, expect, it } from 'vitest';
import {
  calidadPorFotos,
  formatearBytes,
  formatearTiempo,
  MODELO_FALLBACK_POR_DEFECTO,
  resolucionVideoPermitida,
  resolverUrlModeloFallback,
  tiempoEstimadoSeg,
} from './gemelo';

describe('calidadPorFotos (cliente)', () => {
  it('clasifica igual que el worker', () => {
    expect(calidadPorFotos(5).clave).toBe('aproximado');
    expect(calidadPorFotos(15).clave).toBe('moderado');
    expect(calidadPorFotos(30).clave).toBe('bueno');
    expect(calidadPorFotos(60).clave).toBe('alto');
    expect(calidadPorFotos(4).clave).toBe('insuficiente');
  });
});

describe('tiempoEstimadoSeg (cliente)', () => {
  it('coincide con los puntos de referencia del worker', () => {
    expect(tiempoEstimadoSeg(5)).toBe(120);
    expect(tiempoEstimadoSeg(20)).toBe(600);
    expect(tiempoEstimadoSeg(50)).toBe(2400);
    expect(tiempoEstimadoSeg(100)).toBe(5400);
  });

  it('es monótona y más rápida en modo simulación', () => {
    let prev = 0;
    for (let n = 1; n <= 100; n++) {
      const t = tiempoEstimadoSeg(n);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    expect(tiempoEstimadoSeg(50, { modo: 'simular' })).toBeLessThan(tiempoEstimadoSeg(50));
  });
});

describe('resolverUrlModeloFallback', () => {
  it('usa el demo por defecto y normaliza paths relativos', () => {
    expect(resolverUrlModeloFallback()).toBe(MODELO_FALLBACK_POR_DEFECTO);
    expect(resolverUrlModeloFallback('   ')).toBe(MODELO_FALLBACK_POR_DEFECTO);
    expect(resolverUrlModeloFallback('modelos/mi-depto.glb')).toBe('/modelos/mi-depto.glb');
    expect(resolverUrlModeloFallback('/modelos/otro.glb')).toBe('/modelos/otro.glb');
    expect(resolverUrlModeloFallback('https://cdn.ejemplo.com/a.glb')).toBe(
      'https://cdn.ejemplo.com/a.glb'
    );
  });
});

describe('formateadores', () => {
  it('formatea tiempos y bytes', () => {
    expect(formatearTiempo(5400)).toBe('1 h 30 min');
    expect(formatearBytes(2048)).toBe('2.0 KB');
    expect(formatearBytes(5_000_000)).toContain('MB');
  });
});

describe('resolucionVideoPermitida', () => {
  it('acepta horizontal y vertical Full HD', () => {
    expect(resolucionVideoPermitida(1920, 1080)).toBe(true);
    expect(resolucionVideoPermitida(1080, 1920)).toBe(true);
    expect(resolucionVideoPermitida(1280, 720)).toBe(true);
    expect(resolucionVideoPermitida(720, 1280)).toBe(true);
    expect(resolucionVideoPermitida(1080, 1080)).toBe(true);
  });

  it('rechaza resoluciones por encima del límite', () => {
    expect(resolucionVideoPermitida(3840, 2160)).toBe(false);
    expect(resolucionVideoPermitida(2160, 3840)).toBe(false);
    expect(resolucionVideoPermitida(2560, 1440)).toBe(false);
    expect(resolucionVideoPermitida(1920, 1200)).toBe(false);
  });

  it('no bloquea si el navegador no informa la resolución', () => {
    expect(resolucionVideoPermitida(0, 0)).toBe(true);
  });
});
