import { defineMiddleware } from 'astro:middleware';

const peticionesIP = new Map<string, { cantidad: number; reinicio: number }>();

export const onRequest = defineMiddleware(async (context, next) => {
  let ip: string;
  try {
    ip = context.clientAddress;
  } catch {
    return next();
  }

  if (!ip) return next();

  const ahora = Date.now();
  const unMinuto = 60 * 1000;
  const limiteMaximo = 60;

  const registro = peticionesIP.get(ip) || { cantidad: 0, reinicio: ahora + unMinuto };

  if (ahora > registro.reinicio) {
    registro.cantidad = 1;
    registro.reinicio = ahora + unMinuto;
  } else {
    registro.cantidad++;
  }

  peticionesIP.set(ip, registro);

  if (registro.cantidad > limiteMaximo) {
    return new Response('Has hecho demasiadas consultas. Espera un minuto.', {
      status: 429
    });
  }
  return next();
});