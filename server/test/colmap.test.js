import { describe, it, expect } from 'vitest';
import { colmapDisponible, salidaPareceColmap } from '../src/services/colmap.js';

describe('detección de COLMAP', () => {
  it('reconoce la salida de `colmap help` (COLMAP >= 3.11 ya no usa --version)', () => {
    expect(salidaPareceColmap('COLMAP 3.12.6 -- Structure-from-Motion and Multi-View Stereo')).toBe(true);
    expect(salidaPareceColmap('colmap automatic_reconstructor --image_path IMAGES')).toBe(true);
  });

  it('no confunde la salida de otros binarios', () => {
    expect(salidaPareceColmap('v24.15.0')).toBe(false);
    expect(salidaPareceColmap('')).toBe(false);
    expect(salidaPareceColmap(null)).toBe(false);
    expect(salidaPareceColmap(undefined)).toBe(false);
  });

  it('devuelve false si el binario no existe', () => {
    expect(colmapDisponible('binario-que-no-existe-xyz-123')).toBe(false);
  });

  it('no da falso positivo con node (responde 0 a --version pero no es COLMAP)', () => {
    // node "help" falla y `node --version` imprime "vX.Y.Z" → no parece COLMAP.
    expect(colmapDisponible(process.execPath)).toBe(false);
  });
});
