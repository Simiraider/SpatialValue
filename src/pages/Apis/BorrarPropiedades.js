export const prerender = false;
import sql from '../../Backend/carga.js';

export async function DELETE({ request }) {
  try {
    const data = await request.json();
  
    const id_propiedad = data.id; 
    
    const cookieHeader = request.headers.get("cookie") || "";
    const cookies = Object.fromEntries(cookieHeader.split("; ").map(c => c.split("=")));
    const usuarioActual = cookies.usuario_id;
    
    if (!id_propiedad) {
      return new Response(
        JSON.stringify({ error: "Falta el ID de la propiedad" }), 
        { status: 400 }
      );
    }

    const resultado = await sql`
      DELETE FROM propiedades 
      WHERE id = ${id_propiedad} AND usuario_id = ${usuarioActual}
      RETURNING *;
    `;

    if (resultado.length === 0) {
      return new Response(
        JSON.stringify({ error: "No se encontró la propiedad o no tienes permiso para borrarla" }), 
        { status: 404 }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "Eliminado con éxito" }), 
      { status: 200 }
    );

  } catch (error) {
    console.error("Error al eliminar:", error.message);
    return new Response(
      JSON.stringify({ error: "Error interno: " + error.message }), 
      { status: 500 }
    );
  }
}