import sql from './carga.js';

const VENTANA_MAX = 60;

let promesaEsquema = null;

async function crearEsquema() {
  await sql`
    CREATE TABLE IF NOT EXISTS "limite_peticiones" (
      "clave" varchar(200) NOT NULL,
      "ventana" bigint NOT NULL,
      "cuenta" integer NOT NULL DEFAULT 0,
      PRIMARY KEY ("clave", "ventana")
    )
  `;
}

function asegurarEsquema() {
  if (!promesaEsquema) {
    promesaEsquema = crearEsquema().catch((error) => {
      promesaEsquema = null;
      throw error;
    });
  }
  return promesaEsquema;
}

/**
 * Limitador de frecuencia compartido entre instancias.
 *
 * Los endpoints serverless de Vercel no comparten memoria, así que un `Map` en
 * proceso no limita nada. Este cuenta en Postgres por ventana fija.
 *
 * Falla abierto: si la base no responde, deja pasar la petición y avisa por log
 * (es preferible un login disponible a un login caído).
 */
export async function permitirFrecuencia(clave, maximo, ventanaMs = 300_000) {
  const claveRecortada = String(clave).slice(0, 200);

  try {
    await asegurarEsquema();

    const ventana = Math.floor(Date.now() / ventanaMs);

    const filas = await sql`
      INSERT INTO "limite_peticiones" ("clave", "ventana", "cuenta")
      VALUES (${claveRecortada}, ${ventana}, 1)
      ON CONFLICT ("clave", "ventana")
      DO UPDATE SET "cuenta" = "limite_peticiones"."cuenta" + 1
      RETURNING "cuenta"
    `;

    if (Math.random() < 0.02) {
      sql`
        DELETE FROM "limite_peticiones"
        WHERE "ventana" < ${ventana - 24}
      `.catch(() => {});
    }

    return (filas[0]?.cuenta ?? 1) <= maximo;
  } catch (error) {
    console.warn('[limite] No se pudo verificar el límite:', error?.message || error);
    return true;
  }
}

export const MAX_VENTANAS = VENTANA_MAX;
