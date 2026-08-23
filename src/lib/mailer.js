import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST || 'sandbox.smtp.mailtrap.io';
const port = Number(process.env.SMTP_PORT) || 2525;
const user = process.env.SMTP_USER || '';
const pass = process.env.SMTP_PASS || '';
const appUrl = process.env.APP_URL || (process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:4321');

const smtpConfigured = Boolean(user && pass);

let transporter = null;

if (smtpConfigured) {
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  console.log(`[MAILER] SMTP configurado -> ${host}:${port}`);
} else {
  console.warn('[MAILER] SMTP no configurado (faltan SMTP_USER / SMTP_PASS). Los emails no se enviaran.');
}

export async function enviarMailVerificacion(email, usuario, token) {
  if (!transporter) {
    console.warn(`[MAILER] Email de verificacion NO enviado (SMTP no configurado). Token: ${token}`);
    return false;
  }

  const urlConfirmacion = `${appUrl}/api/confirmar-email?token=${token}`;

  try {
    await transporter.sendMail({
      from: '"Spatial Value" <no-reply@spatialvalue.com>',
      to: email,
      subject: 'Verifica tu cuenta en Spatial Value',
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>!Hola, ${usuario}!</h2>
          <p>Gracias por registrarte en Spatial Value. Haz clic en el boton para activar tu cuenta:</p>
          <p style="margin: 20px 0;">
            <a href="${urlConfirmacion}" 
               style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Verificar mi correo
            </a>
          </p>
          <p style="color: #64748b; font-size: 12px;">Si no creaste esta cuenta, ignora este mensaje.</p>
        </div>
      `,
    });
    console.log(`[MAILER] Email de verificacion enviado a ${email}`);
    return true;
  } catch (error) {
    console.error(`[MAILER] Error al enviar email a ${email}:`, error.message);
    return false;
  }
}
