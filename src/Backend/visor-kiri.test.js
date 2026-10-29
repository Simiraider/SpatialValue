import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { extraerGlb, flujoDesdePartes, partesMultipart } from './visor-kiri.js';

async function leerFlujo(flujo) {
  const lector = flujo.getReader();
  const trozos = [];
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    trozos.push(Buffer.from(value));
  }
  return Buffer.concat(trozos);
}

const respuesta = (bytes) => new Response(Buffer.from(bytes));

describe('visor 3D · multipart hacia KIRI', () => {
  it('arma el bloque del video con su nombre y tipo', async () => {
    const partes = partesMultipart({
      boundary: 'B',
      archivos: [
        {
          campo: 'videoFile',
          nombre: 'recorrido.mp4',
          tipo: 'video/mp4',
          abrir: async () => respuesta('VIDEO'),
        },
      ],
      campos: [['fileFormat', 'glb']],
    });

    const cuerpo = (await leerFlujo(flujoDesdePartes(partes))).toString();
    expect(cuerpo).toContain(
      '--B\r\nContent-Disposition: form-data; name="videoFile"; filename="recorrido.mp4"\r\nContent-Type: video/mp4\r\n\r\n'
    );
    expect(cuerpo).toContain('VIDEO\r\n--B');
    expect(cuerpo).toContain('name="fileFormat"\r\n\r\nglb');
    expect(cuerpo.endsWith('--B--\r\n')).toBe(true);
  });

  it('manda varias fotos con el mismo campo imagesFiles', async () => {
    const partes = partesMultipart({
      boundary: 'B',
      archivos: [
        { campo: 'imagesFiles', nombre: '1.jpg', tipo: 'image/jpeg', abrir: async () => respuesta('A') },
        { campo: 'imagesFiles', nombre: '2.jpg', tipo: 'image/jpeg', abrir: async () => respuesta('BB') },
      ],
      campos: [],
    });

    const cuerpo = (await leerFlujo(flujoDesdePartes(partes))).toString();
    expect(cuerpo.match(/name="imagesFiles"/g)).toHaveLength(2);
    expect(cuerpo).toContain('filename="1.jpg"');
    expect(cuerpo).toContain('filename="2.jpg"');
    expect(cuerpo).toContain('A\r\n--B');
    expect(cuerpo).toContain('BB\r\n--B');
  });

  it('sanea nombres con comillas o saltos de línea', async () => {
    const partes = partesMultipart({
      boundary: 'B',
      archivos: [
        { campo: 'imagesFiles', nombre: 'a"b\r\nc.jpg', tipo: 'image/jpeg', abrir: async () => respuesta('X') },
      ],
      campos: [],
    });

    const cuerpo = (await leerFlujo(flujoDesdePartes(partes))).toString();
    expect(cuerpo).toContain('filename="a-b--c.jpg"');
  });

  it('corta con un error claro si el archivo no está en Storage', async () => {
    const partes = partesMultipart({
      boundary: 'B',
      archivos: [
        { campo: 'imagesFiles', nombre: 'perdida.jpg', tipo: 'image/jpeg', abrir: async () => new Response('no', { status: 404 }) },
      ],
      campos: [],
    });

    await expect(leerFlujo(flujoDesdePartes(partes))).rejects.toThrow(/perdida\.jpg/);
  });
});

describe('visor 3D · ZIP de KIRI', () => {
  it('elige el .glb más grande e ignora texturas', () => {
    const zip = zipSync({
      'modelo-small.glb': new Uint8Array([1, 2, 3]),
      'modelo.glb': new Uint8Array([1, 2, 3, 4, 5, 6]),
      'textura.jpg': new Uint8Array([9, 9, 9, 9, 9, 9, 9]),
    });

    expect(extraerGlb(zip)).toHaveLength(6);
  });

  it('falla si el ZIP no trae ningún .glb', () => {
    const zip = zipSync({ 'textura.jpg': new Uint8Array([1, 2]) });
    expect(() => extraerGlb(zip)).toThrow(/no contiene un archivo \.glb/);
  });
});
