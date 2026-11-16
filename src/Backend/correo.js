/**
 * Envío de correo transaccional.
 *
 * Usa SMTP si está configurado. Si no, no falla: devuelve `false` para que el
 * llamador decida (en desarrollo se puede mostrar el enlace/código en pantalla).
 */

export function correoConfigurado() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function enviarCorreo({ to, subject, text, html }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || `Spatial Value <${user}>`;

  if (!host || !user || !pass) {
    console.warn('[correo] SMTP sin configurar: no se envió el mensaje.');
    return false;
  }

  try {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    await transporter.sendMail({ from, to, subject, text, ...(html ? { html } : {}) });
    return true;
  } catch (error) {
    console.error('[correo] Error enviando email:', error?.message || error);
    return false;
  }
}
