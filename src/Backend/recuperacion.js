import crypto from 'node:crypto';
import sql from './carga.js';

const MINUTOS_VIGENCIA = 60;

let promesaEsquema = null;

async function crearEsquema() {
  await sql`
    CREATE TABLE IF NOT EXISTS "recuperacion_password" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "id_usuario" uuid NOT NULL,
      "token_hash" text NOT NULL,
      "expira" timestamptz NOT NULL,
      "usado" boolean NOT NULL DEFAULT false,
      "creado" timestamptz NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS "recuperacion_usuario_idx"
    ON "recuperacion_password" ("id_usuario")
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS "recuperacion_token_idx"
    ON "recuperacion_password" ("token_hash")
  `;
}

export function asegurarEsquemaRecuperacion() {
  if (!promesaEsquema) {
    promesaEsquema = crearEsquema().catch((error) => {
      promesaEsquema = null;
      throw error;
    });
  }
  return promesaEsquema;
}

/** Token aleatorio para el enlace y su hash (sólo el hash se guarda). */
export function generarToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token ?? '')).digest('hex');
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;

export async function crearSolicitud(usuarioId) {
  await asegurarEsquemaRecuperacion();

  const { token, hash } = generarToken();

  // Un solo pedido vigente por usuario: se invalidan los anteriores.
  await sql`DELETE FROM "recuperacion_password" WHERE "id_usuario" = ${usuarioId}`;

  await sql`
    INSERT INTO "recuperacion_password" ("id_usuario", "token_hash", "expira")
    VALUES (${usuarioId}, ${hash}, NOW() + (${MINUTOS_VIGENCIA} * INTERVAL '1 minute'))
  `;

  return { token, minutos: MINUTOS_VIGENCIA };
}

/** Devuelve la fila del token si es válido (no usado y no vencido). */
export async function leerTokenValido(token) {
  if (!TOKEN_RE.test(String(token ?? ''))) return null;

  await asegurarEsquemaRecuperacion();

  const filas = await sql`
    SELECT "id", "id_usuario", "expira", "usado"
    FROM "recuperacion_password"
    WHERE "token_hash" = ${hashToken(token)}
      AND "usado" = false
    ORDER BY "creado" DESC
    LIMIT 1
  `;

  const fila = filas[0];
  if (!fila) return null;
  if (new Date(fila.expira).getTime() < Date.now()) return null;

  return fila;
}

export async function marcarUsado(id) {
  await sql`UPDATE "recuperacion_password" SET "usado" = true WHERE "id" = ${id}`;
}

export async function borrarSolicitudesDe(usuarioId) {
  await sql`DELETE FROM "recuperacion_password" WHERE "id_usuario" = ${usuarioId}`;
}
