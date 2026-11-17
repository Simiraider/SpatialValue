import { randomUUID } from 'node:crypto';
import {
  crearEnKiri,
  crearEnMakeSplat,
  crearEnMASt3R,
  responder,
} from '../../Backend/gemelo-servidor.js';
import { liberarOrden, moverReserva, reservarOrden } from '../../Backend/pagos.js';
import { consultarSaldoKiri } from '../../Backend/visor-kiri.js';
import {
  esPublicacionDelUsuario,
  esUuid,
  exigirSesion,
  limitar,
} from '../../Backend/seguridad.js';

export const prerender = false;

export async function POST({ request, url }) {
  const sesion = exigirSesion(request);
  if (sesion.error) return sesion.error;

  if (!(await limitar(`gemelo-crear:${sesion.usuarioId}`, 6, 3_600_000))) {
    return responder(429, { error: 'Demasiados modelos pedidos. Probá más tarde.', id: null });
  }

  const pagoId = String(url.searchParams.get('pago_id') || '').trim();
  const idPublicacion = String(url.searchParams.get('id_publicacion') || '').trim() || null;

  if (idPublicacion) {
    if (
      !esUuid(idPublicacion) ||
      !(await esPublicacionDelUsuario(sesion.usuarioId, idPublicacion))
    ) {
      return responder(403, { error: 'La publicación no pertenece a tu cuenta.', id: null });
    }
  }

  const titulo = (url.searchParams.get('titulo') || 'Gemelo digital').slice(0, 200);
  const esVideo = url.searchParams.get('es_video') === '1';
  const nFotos = Math.min(
    Math.max(Number(url.searchParams.get('n_fotos') || 0) || 0, 0),
    120
  );
  const base = { titulo, idUsuario: sesion.usuarioId, idPublicacion, nFotos, esVideo };

  const proveedor = process.env.HF_TOKEN
    ? 'mast3r'
    : process.env.KIRI_API_KEY
      ? 'kiri'
      : process.env.MAKESPLAT_API_KEY
        ? 'makesplat'
        : null;

  if (!proveedor) {
    return responder(503, {
      error: 'El motor 3D no está configurado. No se te cobró nada.',
      id: null,
    });
  }

  if (proveedor === 'makesplat' && !esVideo) {
    return responder(422, {
      error:
        'MakeSplat solo procesa video. Subí un MP4/MOV o configurá KIRI_API_KEY. No se te cobró nada.',
      id: null,
    });
  }

  if (proveedor === 'kiri') {
    const saldo = await consultarSaldoKiri();
    if (saldo !== null && saldo < 1) {
      return responder(503, {
        error: 'No hay créditos del motor 3D disponibles. No se te cobró nada.',
        id: null,
      });
    }
  }

  const reserva = randomUUID();
  const reservado = await reservarOrden(sesion.usuarioId, pagoId, reserva);
  if (!reservado) {
    return responder(402, {
      error: 'Falta el pago del modelo 3D o la orden ya se usó.',
      id: null,
    });
  }

  try {
    const fila =
      proveedor === 'mast3r'
        ? await crearEnMASt3R({ request, url, ...base })
        : proveedor === 'kiri'
          ? await crearEnKiri({ request, url, ...base })
          : await crearEnMakeSplat({ request, ...base });

    await moverReserva(reserva, fila.id);
    return responder(200, { id: fila.id, motor: fila.motor, error: null });
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'Error desconocido';
    await liberarOrden(reserva).catch(() => {});
    return responder(502, {
      error: `No se pudo iniciar el modelo 3D: ${mensaje}. No se te cobró nada.`,
      id: null,
    });
  }
}
