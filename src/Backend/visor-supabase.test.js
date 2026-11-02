import { describe, expect, it } from 'vitest';
import { afterEach } from 'vitest';
import {
  claveEsPublica,
  clasificarArchivo,
  codificarRuta,
  estadoDesdeFila,
  nombreSeguro,
  rutaMedia,
  rutaModelo,
  tipoClave,
  visorOperativo,
} from './visor-supabase.js';

describe('visor 3D · rutas en Supabase Storage', () => {
  it('normaliza nombres con acentos, espacios, paréntesis y rutas', () => {
    expect(nombreSeguro('Baño principal (1).JPG')).toBe('Bano-principal-1-.JPG');
    expect(nombreSeguro('C:\\fotos\\Living room.mp4')).toBe('Living-room.mp4');
    expect(nombreSeguro('../../etc/passwd')).toBe('passwd');
    expect(nombreSeguro('')).toBe('archivo');
  });

  it('codifica cada segmento sin romper las barras', () => {
    expect(codificarRuta('id/media/0-video final.mp4')).toBe('id/media/0-video%20final.mp4');
    expect(codificarRuta('/id//modelo.glb/')).toBe('id/modelo.glb');
  });

  it('arma rutas estables por trabajo', () => {
    expect(rutaMedia('abc-123', 0, 'foto 1.jpg')).toBe('abc-123/media/0-foto-1.jpg');
    expect(rutaModelo('abc-123')).toBe('abc-123/modelo.glb');
  });
});

describe('visor 3D · clasificación de archivos', () => {
  it('reconoce imágenes y videos por MIME o extensión', () => {
    expect(clasificarArchivo('image/heic', 'IMG_0001.HEIC')).toBe('imagen');
    expect(clasificarArchivo('', 'foto.jpeg')).toBe('imagen');
    expect(clasificarArchivo('video/mp4', 'recorrido.mp4')).toBe('video');
    expect(clasificarArchivo('', 'recorrido.MOV')).toBe('video');
  });

  it('rechaza lo que el proveedor no acepta', () => {
    expect(clasificarArchivo('application/pdf', 'plano.pdf')).toBeNull();
    expect(clasificarArchivo('', 'modelo.glb')).toBeNull();
    expect(clasificarArchivo('', '')).toBeNull();
  });
});

describe('visor 3D · normalización del estado', () => {
  const base = {
    id: 'j1',
    titulo: 'Living',
    estado: 'subido',
    etapa: 'reconstruyendo',
    progreso: 90,
    mensaje: 'Material guardado',
    es_video: true,
    n_fotos: 0,
    calidad: 'equilibrada',
    modelo_path: null,
    modelo_url: null,
    modelo_bytes: null,
    error: null,
    creado_en: '2026-10-28T10:00:00.000Z',
    expira_en: '2026-11-04T10:00:00.000Z',
  };

  it('traduce los estados de la base al contrato del visor', () => {
    const estado = estadoDesdeFila(base);
    expect(estado).toMatchObject({
      id: 'j1',
      estado: 'pendiente',
      etapa: 'reconstruyendo',
      modeloUrl: null,
      esVideo: true,
      motor: 'externo',
    });
    expect(estado.expiraEn).toBe(Date.parse(base.expira_en));
  });

  it('expone el .glb por la API cuando ya está guardado', () => {
    const estado = estadoDesdeFila({ ...base, estado: 'listo', modelo_path: 'j1/modelo.glb', modelo_bytes: 2048 });
    expect(estado.estado).toBe('listo');
    expect(estado.etapa).toBe('listo');
    expect(estado.modeloUrl).toBe('/api/visor/glb/j1');
    expect(estado.modeloBytes).toBe(2048);
  });

  it('respeta un enlace externo si no hay archivo propio', () => {
    const estado = estadoDesdeFila({
      ...base,
      estado: 'listo',
      modelo_url: 'https://cdn.example.com/modelo.glb',
    });
    expect(estado.modeloUrl).toBe('https://cdn.example.com/modelo.glb');
  });

  it('devuelve null cuando no hay fila', () => {
    expect(estadoDesdeFila(null)).toBeNull();
  });
});

describe('visor 3D · clave de Supabase', () => {
  const jwt = (payload) =>
    `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;

  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('rechaza la clave pública', () => {
    process.env.SUPABASE_URL = 'https://demo.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_publishable_abc123';
    expect(tipoClave()).toBe('publica');
    expect(claveEsPublica()).toBe(true);
    expect(visorOperativo()).toBe(false);
  });

  it('rechaza el JWT anon', () => {
    process.env.SUPABASE_URL = 'https://demo.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = jwt({ role: 'anon' });
    expect(tipoClave()).toBe('jwt-otro');
    expect(visorOperativo()).toBe(false);
  });

  it('acepta la secret key nueva', () => {
    process.env.SUPABASE_URL = 'https://demo.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_abc123';
    expect(tipoClave()).toBe('secret');
    expect(visorOperativo()).toBe(true);
  });

  it('acepta el JWT de service_role', () => {
    process.env.SUPABASE_URL = 'https://demo.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = jwt({ role: 'service_role' });
    expect(tipoClave()).toBe('service_role');
    expect(visorOperativo()).toBe(true);
  });

  it('no queda operativo sin configuración', () => {
    expect(tipoClave()).toBe('ausente');
    expect(visorOperativo()).toBe(false);
  });
});
