
const numero = (valor, defecto) => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : defecto;
};

const crearConfig = (env = process.env) => {
  const minFotos = Math.round(numero(env.GEMELO_MIN_FOTOS, 5));
  const maxFotos = Math.round(numero(env.GEMELO_MAX_FOTOS, 100));
  const maxVideoMb = Math.max(300, Math.round(numero(env.GEMELO_MAX_VIDEO_MB, 500))); 
  const ttlHoras = numero(env.GEMELO_TTL_HORAS, 1);
  const maxJobsPorIp = Math.round(numero(env.GEMELO_MAX_JOBS_POR_IP, 5));
  const velocidadSimulacionMs = Math.round(numero(env.GEMELO_SIM_VELOCIDAD_MS, 1200));

  const config = {
    port: numero(env.PORT, 4000),
    corsOrigin: env.CORS_ORIGIN || '*',
    modo: (env.GEMELO_MODO || 'auto').toLowerCase(),
    minFotos,
    maxFotos: Math.max(maxFotos, minFotos),
    maxVideoMb,
    ttlHoras,
    ttlMs: ttlHoras * 3600 * 1000,
    dataDir: env.GEMELO_DATA_DIR || './data',
    colmapBin: env.COLMAP_BIN || 'colmap',
    ffmpegBin: env.FFMPEG_BIN || 'ffmpeg',
    workerToken: env.WORKER_TOKEN || '',
    rateLimit: {
      max: maxJobsPorIp,
      windowMs: 10 * 60 * 1000, 
    },
    s3: {
      bucket: env.S3_BUCKET || '',
      region: env.S3_REGION || 'us-east-1',
      endpoint: env.S3_ENDPOINT || '',
      accessKeyId: env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY || '',
    },
    velocidadSimulacionMs,
    keepFotos: env.GEMELO_KEEP_FOTOS === '1' || env.GEMELO_KEEP_FOTOS === 'true',
    kaggle: {
      bin: env.KAGGLE_BIN || 'kaggle',
      username: env.KAGGLE_USERNAME || '',
      key: env.KAGGLE_KEY || '',
      apiToken: env.KAGGLE_API_TOKEN || '',
    },    dense: {
      habilitado: env.GEMELO_DENSE === 'kaggle',
      kernelId: env.GEMELO_KAGGLE_KERNEL_ID || '',
      datasetSlug: env.GEMELO_KAGGLE_DATASET || '',
      timeoutMs: numero(env.GEMELO_DENSE_TIMEOUT_MS, 90 * 60 * 1000),
    },
  };

  if (!['auto', 'colmap', 'simular'].includes(config.modo)) {
    throw new Error(`GEMELO_MODO inválido: "${config.modo}". Usá auto | colmap | simular`);
  }
  if (config.modo === 'simular' && config.workerToken) {
    console.warn('[config] GEMELO_MODO=simular detectado con WORKER_TOKEN: recordá desactivarlo en producción real.');
  }
  return config;
};

export default crearConfig;
