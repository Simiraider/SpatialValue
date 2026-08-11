import { describe, it, expect } from 'vitest';
import { calidadPorFotos } from '../src/services/confianza.js';

describe('calidadPorFotos', () => {
  it('clasifica correctamente los rangos de la especificación', () => {
    expect(calidadPorFotos(0).clave).toBe('invalido');
    expect(calidadPorFotos(4).clave).toBe('insuficiente');
    expect(calidadPorFotos(5).clave).toBe('aproximado');
    expect(calidadPorFotos(14).clave).toBe('aproximado');
    expect(calidadPorFotos(15).clave).toBe('moderado');
    expect(calidadPorFotos(29).clave).toBe('moderado');
    expect(calidadPorFotos(30).clave).toBe('bueno');
    expect(calidadPorFotos(59).clave).toBe('bueno');
    expect(calidadPorFotos(60).clave).toBe('alto');
    expect(calidadPorFotos(100).clave).toBe('alto');
  });

  it('es monótona: más fotos nunca bajan la calidad', () => {
    let nivel = -1;
    for (let n = 0; n <= 100; n++) {
      const actual = calidadPorFotos(n).nivel;
      expect(actual).toBeGreaterThanOrEqual(nivel);
      nivel = actual;
    }
  });

  it('devuelve mensajes en español útiles', () => {
    const aprox = calidadPorFotos(8);
    expect(aprox.mensaje).toContain('aproximado');
    expect(aprox.etiqueta.length).toBeGreaterThan(0);
  });
});
