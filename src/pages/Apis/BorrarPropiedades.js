export const prerender = false;
import sql from '../../Backend/carga.js';

export async function DELETE({ request }) {
  try {
    const data = await request.json();
  
    const id_publicacion = data.id_publicacion || data.id; 
    
    const cookieHeader = request.headers.get("cookie") || "";
    const cookies = Object.fromEntries(
      cookieHeader.split("; ").filter(Boolean).map(c => {
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

    const resultado = await sql`
      DELETE FROM publicaciones 
      WHERE id_publicacion = ${id_publicacion} AND id_usuario = ${usuarioActual}
      RETURNING *;
    `;

    if (resultado.length === 0) {
      return new Response(
        JSON.stringify({ error: "No se encontró la publicación o no tienes permiso para eliminarla" }), 
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "Publicación eliminada con éxito" }), 
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error al eliminar publicación:", error.message);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }), 
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}