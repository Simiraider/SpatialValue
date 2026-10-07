import { describe, it, expect } from 'vitest';
import crearConfig from '../src/config.js';
import { kaggleDisponible } from '../src/services/nube/kaggle.js';

describe('configuración del densificado en nube', () => {
  it('por defecto está deshabilitado', () => {
    const c = crearConfig({});
    expect(c.dense.habilitado).toBe(false);
    expect(c.kaggle.bin).toBe('kaggle');
  });

  it('se habilita con GEMELO_DENSE=kaggle y toma kernel/dataset', () => {
    const c = crearConfig({
      GEMELO_DENSE: 'kaggle',
      GEMELO_KAGGLE_KERNEL_ID: 'user/kernel',
      GEMELO_KAGGLE_DATASET: 'user/ds',
      KAGGLE_USERNAME: 'user',
      KAGGLE_KEY: 'clave',
    });
    expect(c.dense.habilitado).toBe(true);
    expect(c.dense.kernelId).toBe('user/kernel');
    expect(c.dense.datasetSlug).toBe('user/ds');
    expect(c.kaggle.username).toBe('user');
  });

  it('el timeout por defecto es 90 minutos', () => {
    const c = crearConfig({});
    expect(c.dense.timeoutMs).toBe(90 * 60 * 1000);
  });
});

describe('kaggleDisponible', () => {
  it('false sin credenciales', () => {
    const c = crearConfig({ KAGGLE_CONFIG_DIR: '/ruta/inexistente-xyz' });
    expect(kaggleDisponible(c)).toBe(false);
  });

  it('true con usuario y key', () => {
    const c = crearConfig({ GEMELO_DENSE: 'kaggle', KAGGLE_USERNAME: 'u', KAGGLE_KEY: 'k' });
    expect(kaggleDisponible(c)).toBe(true);
  });

  it('true con el token nuevo KAGGLE_API_TOKEN', () => {
    const c = crearConfig({ GEMELO_DENSE: 'kaggle', KAGGLE_API_TOKEN: 'KGAT_abc' });
    expect(kaggleDisponible(c)).toBe(true);
  });
});
