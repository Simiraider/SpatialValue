export const prerender = false;
import sql from '../../Backend/carga.js';

export async function GET({ url }) {
  try {
    const usuarioId = url.searchParams.get('usuario_id');

    let propiedades;

    if (usuarioId) {
      propiedades = await sql`
        SELECT p.*, u."Nombre" as autor 
        FROM "Propiedades" p
        JOIN "Usuarios" u ON p.usuario_id = u.id
        WHERE p.usuario_id = ${usuarioId}
        ORDER BY p.creada_en DESC
      `;
    } else {
      propiedades = await sql`
        SELECT p.*, u."Nombre" as autor 
        FROM "Propiedades" p
        JOIN "Usuarios" u ON p.usuario_id = u.id
        ORDER BY p.creada_en DESC
      `;
    }

    return new Response(JSON.stringify(propiedades), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Error al obtener propiedades:", error.message);
    return new Response(JSON.stringify({ error: "Error al cargar propiedades" }), { 
      status: 500 
    });
  }
}