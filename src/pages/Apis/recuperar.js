export const prerender = false;

import sql from '../../Backend/carga.js';
import { crearSolicitud, asegurarEsquemaRecuperacion } from '../../Backend/recuperacion.js';
import { enviarCorreo, correoConfigurado } from '../../Backend/correo.js';
import { ipDePeticion, esMismoOrigen } from '../../Backend/sesion.js';
import { permitirFrecuencia } from '../../Backend/limite.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(cuerpo, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const RESPUESTA_NEUTRA =
  'Si ese email tiene una cuenta en Spatial Value, te enviamos un enlace para restablecer la contraseña. Revisá también el correo no deseado.';

export async function POST({ request }) {
  try {
    if (!esMismoOrigen(request)) {
      return json({ error: 'Origen no permitido.' }, 403);
    }

    if (!(await permitirFrecuencia(`recuperar:${ipDePeticion(request)}`, 5, 3_600_000))) {
      return json({ error: 'Demasiados pedidos. Esperá unos minutos y volvé a intentar.' }, 429);
    }

    const body = await request.json().catch(() => null);
    const email = String(body?.email ?? '').trim().toLowerCase();

    if (!EMAIL_RE.test(email) || email.length > 200) {
      return json({ error: 'Ingresá un email válido.' }, 400);
    }

    const usuarios = await sql`
      SELECT "id_usuario" FROM "usuarios" WHERE LOWER("email") = ${email} LIMIT 1
    `;

    const usuario = usuarios[0];

    // Respuesta idéntica exista o no la cuenta: no se puede enumerar usuarios.
    if (!usuario) {
      return json({ success: true, mensaje: RESPUESTA_NEUTRA });
    }

    // Anti-spam por cuenta: un pedido cada 2 minutos.
    await asegurarEsquemaRecuperacion();
    const recientes = await sql`
      SELECT COUNT(*)::int AS n FROM "recuperacion_password"
      WHERE "id_usuario" = ${usuario.id_usuario}
        AND "creado" > NOW() - INTERVAL '2 minutes'
    `;
    if ((recientes[0]?.n ?? 0) >= 1) {
      return json({ success: true, mensaje: RESPUESTA_NEUTRA });
    }

    const { token, minutos } = await crearSolicitud(usuario.id_usuario);

    const enlace = `${new URL(request.url).origin}/restablecer?token=${encodeURIComponent(token)}`;

    const enviado = await enviarCorreo({
      to: email,
      subject: 'Restablecé tu contraseña · Spatial Value',
      text:
        'Pediste restablecer tu contraseña en Spatial Value.\n\n' +
        `Abrí este enlace para elegir una nueva:\n${enlace}\n\n` +
        `El enlace vence en ${minutos} minutos y sirve una sola vez.\n` +
        'Si no fuiste vos, ignorá este mensaje: tu contraseña no cambia.',
      html: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a">
          <h2 style="color:#0087c0">Restablecé tu contraseña</h2>
          <p>Pediste restablecer tu contraseña en <strong>Spatial Value</strong>.</p>
          <p>
            <a href="${enlace}"
               style="display:inline-block;background:#0087c0;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">
              Elegir nueva contraseña
            </a>
          </p>
          <p style="font-size:13px;color:#64748b">
            El enlace vence en ${minutos} minutos y sirve una sola vez.
            Si no fuiste vos, ignorá este mensaje: tu contraseña no cambia.
          </p>
        </div>
      `,
    });

    // Sin SMTP configurado: en desarrollo devolvemos el enlace para poder probar.
    if (!enviado && !correoConfigurado() && String(process.env.NODE_ENV) !== 'production') {
      return json({
        success: true,
        mensaje: 'El envío de correo no está configurado en este entorno.',
        enlace_desarrollo: enlace,
      });
    }

    return json({ success: true, mensaje: RESPUESTA_NEUTRA });
  } catch (error) {
    console.error('Error en recuperar:', error?.message || error);
    return json({ error: 'No pudimos procesar el pedido. Probá de nuevo en unos minutos.' }, 500);
  }
}
