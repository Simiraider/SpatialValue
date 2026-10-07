
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';

export function s3Configurado(config) {
  return Boolean(config.s3?.bucket);
}

export async function subirAS3(config, jobId, glbPath) {
  const { S3Client, PutObjectCommand, GetObjectCommand, getSignedUrl } = await import('@aws-sdk/client-s3');
  const { bucket, region, endpoint, accessKeyId, secretAccessKey } = config.s3;
  const client = new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    credentials:
      accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : undefined,
  });
  const key = `gemelo/${jobId}/modelo.glb`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(glbPath),
      ContentType: 'model/gltf-binary',
      CacheControl: 'public, max-age=300',
    })
  );
  const urlFirmada = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: Math.max(config.ttlHoras * 3600, 300),
  });
  logger.info(`[storage] modelo subido a s3://${bucket}/${key}`);
  return { tipo: 's3', key, urlFirmada };
}

export async function guardarModelo(config, jobId, glbPath) {
  if (s3Configurado(config)) {
    try {
      const res = await subirAS3(config, jobId, glbPath);
      return res;
    } catch (e) {
      logger.warn('[storage] falló la subida a S3, se sirve local:', e.message);
    }
  }
  return { tipo: 'local', ruta: glbPath };
}
