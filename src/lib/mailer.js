import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const host = process.env.SMTP_HOST || import.meta.env.SMTP_HOST || 'sandbox.smtp.mailtrap.io';
const port = Number(process.env.SMTP_PORT || import.meta.env.SMTP_PORT) || 2525;
const user = process.env.SMTP_USER || import.meta.env.SMTP_USER;
const pass = process.env.SMTP_PASS || import.meta.env.SMTP_PASS;

console.log(`[MAILER] Conectando a host: ${host}:${port}`);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 2525,
  secure: false, 
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function enviarMailVerificacion(email, usuario, token) {
  const urlConfirmacion = `${process.env.APP_URL}/api/confirmar-email?token=${token}`;

  await transporter.sendMail({
    from: '"Spatial Value" <no-reply@spatialvalue.com>',
    to: email,
    subject: 'Verifica tu cuenta en Spatial Value',
    html: `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2>¡Hola, ${usuario}!</h2>
        <p>Gracias por registrarte en Spatial Value. Haz clic en el botón para activar tu cuenta:</p>
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
}