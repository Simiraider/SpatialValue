export const prerender = false;
import sql from '../../Backend/carga.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST({ request }) {
  try {
    const data = await request.json();

    const id_publicacion = data.id_publicacion || data.id;
    const nuevoEstado = data.estado_tasacion;

    const cookieHeader = request.headers.get("cookie") || "";
    const cookies = Object.fromEntries(
      cookieHeader.split("; ").filter(Boolean).map((c) => {
        const [key, ...v] = c.split("=");
        return [key, v.join("=")];
      })
    );

    const usuarioActual = [cookies.usuario_id, data.usuario_id, data.id_usuario].find(
      (v) => v && v !== "undefined" && v !== "null"
    );

    if (!usuarioActual) {
      return new Response(
        JSON.stringify({ error: "No has iniciado sesión. Volvé a iniciar sesión e intentá de nuevo." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!id_publicacion) {
      return new Response(
        JSON.stringify({ error: "Falta el ID de la publicación" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!UUID_RE.test(String(id_publicacion)) || !UUID_RE.test(String(usuarioActual))) {
      return new Response(
        JSON.stringify({ error: "Identificadores inválidos" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (nuevoEstado !== "borrador" && nuevoEstado !== "completada") {
      return new Response(
        JSON.stringify({ error: "estado_tasacion debe ser 'borrador' o 'completada'" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    await sql`ALTER TABLE publicaciones ADD COLUMN IF NOT EXISTS estado_tasacion varchar(20) NOT NULL DEFAULT 'completada'`;

    const resultado = await sql`
      UPDATE publicaciones
      SET estado_tasacion = ${nuevoEstado}, fecha_actualizacion = NOW()
      WHERE id_publicacion::text = ${id_publicacion} AND id_usuario::text = ${usuarioActual}
      RETURNING id_publicacion, estado_tasacion;
    `;

    if (resultado.length === 0) {
      return new Response(
        JSON.stringify({ error: "No se encontró la tasación o no tenés permiso para modificarla" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: nuevoEstado === "completada" ? "Tasación marcada como completada" : "Tasación movida a borradores",
        data: resultado[0],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error al actualizar el estado de la tasación:", error.message);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
