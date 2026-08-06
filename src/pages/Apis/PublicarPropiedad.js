export const prerender = false;
import sql from '../../Backend/carga.js';

export async function POST({ request }) {
  try {
    const data = await request.json();

    const { 
      titulo, 
      descripcion, 
      tipo_operacion = 'venta',
      tipo_propiedad = 'departamento',
      precio, 
      moneda = 'USD',
      expensas = 0,
      direccion, 
      barrio,
      ciudad = 'Buenos Aires', 
      ambientes = 1,
      dormitorios = 0, 
      banos = 1, 
      cocheras = 0,
      superficie_cubierta, 
      superficie_total,
      latitud,
      longitud,
      usuario_id // O id_usuario
    } = data;

    const idUsuarioFinal = usuario_id || data.id_usuario;

    // Validación de campos obligatorios según el esquema SQL
    if (!titulo || !precio || !direccion || !idUsuarioFinal) {
      return new Response(
        JSON.stringify({ error: "Faltan campos obligatorios (título, precio, dirección o usuario)" }), 
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const nuevaPublicacion = await sql`
      INSERT INTO publicaciones (
        id_usuario,
        titulo, 
        descripcion, 
        tipo_operacion,
        tipo_propiedad,
        precio, 
        moneda,
        expensas,
        superficie_total,
        superficie_cubierta,
        ambientes,
        dormitorios, 
        banos, 
        cocheras,
        direccion, 
        barrio,
        ciudad, 
        latitud,
        longitud
      )
      VALUES (
        ${idUsuarioFinal},
        ${titulo}, 
        ${descripcion || null}, 
        ${tipo_operacion},
        ${tipo_propiedad},
        ${precio}, 
        ${moneda},
        ${expensas},
        ${superficie_total || superficie_cubierta || null},
        ${superficie_cubierta || superficie_total || null},
        ${ambientes},
        ${dormitorios}, 
        ${banos}, 
        ${cocheras},
        ${direccion}, 
        ${barrio || null}, 
        ${ciudad}, 
        ${latitud || null},
        ${longitud || null}
      )
      RETURNING *; 
    `;

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Publicación creada con éxito",
        data: nuevaPublicacion[0] 
      }), 
      { status: 201, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error al crear publicación:", error.message);

    if (error.message.includes("violates foreign key constraint")) {
      return new Response(
        JSON.stringify({ error: "El usuario proporcionado no existe en la base de datos" }), 
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Error interno al procesar la publicación" }), 
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}