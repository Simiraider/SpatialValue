export const prerender = false;
import sql from '../carga.js';

export async function DELETE({ request }) {
  try {
    const session = await getSession(request);
    const usuarioActual = session.user.id;
    const { id_propiedad } = await request.json();

    if (!id || !usuario_id) {
      return new Response(
        JSON.stringify({ error: "Faltan datos para procesar la eliminación" }), 
        { status: 400 }
      );
    }

    const resultado = await sql`
      DELETE FROM "Propiedades" 
      WHERE id = ${id_propiedad} AND usuario_id = ${usuarioActual}
      RETURNING *;
    `;

    if (resultado.length === 0) {
      return new Response(
        JSON.stringify({ error: "No se encontró la propiedad o no tienes permiso" }), 
        { status: 404 }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "Propiedad eliminada correctamente" }), 
      { status: 200 }
    );

  } catch (error) {
    console.error("Error al eliminar:", error.message);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }), 
      { status: 500 }
    );
  }
}