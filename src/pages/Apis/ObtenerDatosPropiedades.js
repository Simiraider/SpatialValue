export const prerender = false;
import sql from '../../Backend/carga.js';

export async function GET({ url }) {
  try {
    const usuarioId = url.searchParams.get('usuario_id');

    const esUsuarioValido = usuarioId && 
                            usuarioId !== 'undefined' && 
                            usuarioId !== 'null' && 
                            usuarioId.trim() !== '';

    let publicaciones;

    if (esUsuarioValido) {
      publicaciones = await sql`
        SELECT p.*, u."nombre" as autor 
        FROM "publicaciones" p
        JOIN "usuarios" u ON p.id_usuario = u.id_usuario
        WHERE p.id_usuario = ${usuarioId}
        ORDER BY p.fecha_creacion DESC
      `;
    } else {
      publicaciones = await sql`
        SELECT p.*, u."nombre" as autor 
        FROM "publicaciones" p
        JOIN "usuarios" u ON p.id_usuario = u.id_usuario
        ORDER BY p.fecha_creacion DESC
      `;
    }

    return new Response(JSON.stringify(publicaciones), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Error al obtener publicaciones:", error.message);
    return new Response(JSON.stringify({ error: "Error al cargar publicaciones" }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}