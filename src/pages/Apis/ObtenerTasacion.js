export const prerender = false;
import sql from '../../Backend/carga.js';

export async function GET({ url, request }) {
  try {
    const id = url.searchParams.get('id');
    const usuarioIdQuery = url.searchParams.get('usuario_id');

    const cookieHeader = request.headers.get("cookie") || "";
    const cookies = Object.fromEntries(
      cookieHeader.split("; ").filter(Boolean).map((c) => {
        const [key, ...v] = c.split("=");
        return [key, v.join("=")];
      })
    );

    const usuarioActual = [cookies.usuario_id, usuarioIdQuery].find(
      (v) => v && v !== "undefined" && v !== "null"
    );

    if (!id || id === "undefined" || id === "null") {
      return new Response(
        JSON.stringify({ error: "Falta el ID de la tasación" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!usuarioActual) {
      return new Response(
        JSON.stringify({ error: "No has iniciado sesión" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const publicaciones = await sql`
      SELECT p.*, u."nombre" as autor
      FROM "publicaciones" p
      JOIN "usuarios" u ON p.id_usuario = u.id_usuario
      WHERE p.id_publicacion = ${id} AND p.id_usuario = ${usuarioActual}
    `;

    if (publicaciones.length === 0) {
      return new Response(
        JSON.stringify({ error: "No se encontró la tasación o no tienes permiso para verla" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(publicaciones[0]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error al obtener la tasación:", error.message);
    return new Response(
      JSON.stringify({ error: "Error al cargar la tasación" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
