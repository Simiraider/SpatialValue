import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import crearConfig from '../src/config.js';

// PNG 1x1 válido (mínimo posible).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let app;
let dir;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemelo-api-'));
  const config = crearConfig({
    GEMELO_MODO: 'simular',
    GEMELO_MIN_FOTOS: '5',
    GEMELO_MAX_FOTOS: '100',
    GEMELO_DATA_DIR: dir,
    GEMELO_SIM_VELOCIDAD_MS: '30',
    GEMELO_MAX_JOBS_POR_IP: '1000',
    GEMELO_TTL_HORAS: '1',
    CORS_ORIGIN: '*',
    PORT: '0',
  });
  const creada = crearApp({ config });
  app = creada.app;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const esperarListo = async (id, timeoutMs = 10000) => {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const res = await request(app).get(`/api/jobs/${id}`);
    if (res.status === 200 && res.body.estado === 'listo') return res.body;
    if (res.status === 200 && res.body.estado === 'error') {
      throw new Error('Trabajo en estado error: ' + (res.body.error || 'sin detalle'));
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Timeout esperando trabajo listo');
};

const crearConFotos = (cantidad, extra = {}) => {
  let req = request(app).post('/api/jobs').field('titulo', 'Test depto').field('id_usuario', 'u-test');
  if (extra.opciones) req = req.field('opciones', JSON.stringify(extra.opciones));
  for (let i = 0; i < cantidad; i++) {
    req = req.attach('fotos', PNG, `foto${i}.png`);
  }
  return req;
};

describe('API del worker', () => {
  it('GET /api/healthz responde con el modo del worker', async () => {
    const res = await request(app).get('/api/healthz');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.modo).toBe('simular');
  });

  it('POST /api/jobs sin archivos → 400', async () => {
    const res = await request(app).post('/api/jobs');
    expect(res.status).toBe(400);
  });

  it('POST /api/jobs con menos fotos que el mínimo → 400', async () => {
    const res = await crearConFotos(2);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('5');
  });

  it('POST /api/jobs con formato no soportado → 400', async () => {
    const res = await request(app).post('/api/jobs').attach('fotos', Buffer.from('hola'), 'nota.txt');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Formato no soportado');
  });

  it('flujo completo: crear → procesar → listo → descargar → borrar', async () => {
    const creado = await crearConFotos(5);
    expect(creado.status).toBe(201);
    const { id, totalFotos, calidadEstimada, tiempoEstimadoSeg } = creado.body;
    expect(id).toBeTruthy();
    expect(totalFotos).toBe(5);
    expect(calidadEstimada).toBe('aproximado');
    expect(tiempoEstimadoSeg).toBeGreaterThan(0);

    const listo = await esperarListo(id);
    expect(listo.estado).toBe('listo');
    expect(listo.progreso).toBe(100);
    expect(listo.modeloUrl).toContain(id);
    expect(listo.modeloBytes).toBeGreaterThan(1000);
    expect(listo.motor).toBe('simular');

    const modelo = await request(app).get(`/api/jobs/${id}/modelo`);
    expect(modelo.status).toBe(200);
    expect(modelo.headers['content-type']).toContain('model/gltf-binary');
    expect(modelo.headers['content-length']).toBe(String(listo.modeloBytes));
    expect(modelo.body).toBeTruthy();

    const del = await request(app).delete(`/api/jobs/${id}`);
    expect(del.status).toBe(204);
    const gone = await request(app).get(`/api/jobs/${id}`);
    expect(gone.status).toBe(404);
  });

  it('un video sin ffmpeg termina en estado error (no queda trabado) y borra los archivos', async () => {
    // En esta máquina ffmpeg no está instalado (healthz lo reporta). Si algún
    // día lo está, los bytes basura del video igual hacen fallar la extracción:
    // el resultado determinístico es estado 'error' + input eliminado.
    const creado = await request(app)
      .post('/api/jobs')
      .field('titulo', 'Video roto')
      .attach('fotos', Buffer.from('no soy un video real'), 'video.mp4');
    expect(creado.status).toBe(201);

    const inicio = Date.now();
    let estado = null;
    while (Date.now() - inicio < 10000) {
      const res = await request(app).get(`/api/jobs/${creado.body.id}`);
      estado = res.body;
      if (estado.estado === 'error') break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(estado?.estado).toBe('error');
    expect(estado?.error).toBeTruthy();
    // Las fotos/video también se borran cuando el trabajo falla.
    const inputDir = path.join(dir, 'jobs', creado.body.id, 'input');
    expect(fs.existsSync(inputDir)).toBe(false);
  });

  it('las fotos subidas se borran después de procesar', async () => {
    const creado = await crearConFotos(5);
    await esperarListo(creado.body.id);
    const inputDir = path.join(dir, 'jobs', creado.body.id, 'input');
    expect(fs.existsSync(inputDir)).toBe(false);
  });

  it('GET /api/jobs/:id/modelo antes de estar listo → 409', async () => {
    // App dedicada con simulación lenta para poder "atrapar" el trabajo en curso.
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gemelo-api2-'));
    const config2 = crearConfig({
      GEMELO_MODO: 'simular',
      GEMELO_MIN_FOTOS: '5',
      GEMELO_DATA_DIR: dir2,
      GEMELO_SIM_VELOCIDAD_MS: '4000',
      GEMELO_MAX_JOBS_POR_IP: '1000',
      PORT: '0',
    });
    const app2 = crearApp({ config: config2 }).app;
    let req2 = request(app2).post('/api/jobs').field('titulo', 'lento');
    for (let i = 0; i < 5; i++) req2 = req2.attach('fotos', PNG, `f${i}.png`);
    const res2 = await req2;
    const modelo = await request(app2).get(`/api/jobs/${res2.body.id}/modelo`);
    expect(modelo.status).toBe(409);
    fs.rmSync(dir2, { recursive: true, force: true });
  });

  it('GET /api/jobs (admin) requiere token cuando está configurado', async () => {
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'gemelo-api3-'));
    const config3 = crearConfig({
      GEMELO_MODO: 'simular',
      GEMELO_DATA_DIR: dir3,
      WORKER_TOKEN: 'secreto',
      GEMELO_MAX_JOBS_POR_IP: '1000',
      PORT: '0',
    });
    const app3 = crearApp({ config: config3 }).app;
    const sinToken = await request(app3).get('/api/jobs');
    expect(sinToken.status).toBe(401);
    const conToken = await request(app3).get('/api/jobs').set('X-Worker-Token', 'secreto');
    expect(conToken.status).toBe(200);
    expect(Array.isArray(conToken.body.trabajos)).toBe(true);
    fs.rmSync(dir3, { recursive: true, force: true });
  });
});
