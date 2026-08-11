# Worker de gemelos digitales de SpatialValue.
# Uso en VPS:
#   docker build -t spatial-value-gemelo .
#   docker run -d --name gemelo -p 4000:4000 \
#     -e GEMELO_MODO=auto \
#     -e CORS_ORIGIN=https://tu-frontend.vercel.app \
#     -v gemelo-data:/data \
#     spatial-value-gemelo

FROM node:22-bookworm-slim

# ffmpeg siempre disponible. COLMAP se intenta desde apt (best effort):
# si no existe en la distro, el worker cae automáticamente al modo simulación.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && (apt-get install -y --no-install-recommends colmap || true) \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev \
    && npm cache clean --force

COPY src ./src

ENV NODE_ENV=production \
    PORT=4000 \
    GEMELO_DATA_DIR=/data \
    GEMELO_MODO=auto

EXPOSE 4000

CMD ["node", "src/index.js"]
