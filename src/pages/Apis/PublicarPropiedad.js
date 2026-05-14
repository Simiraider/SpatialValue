export const prerender = false;
import sql from '../../Backend/carga.js';

export async function POST({ request }) {
  try {
    const { 
      titulo, 
      descripcion, 
      precio, 
      direccion, 
      ciudad, 
      habitaciones, 
      baños, 
      area_m2, 
      usuario_id 
    } = await request.json();

    if (!titulo || !precio || !usuario_id) {
      return new Response(
        JSON.stringify({ error: "Faltan campos obligatorios (título, precio o usuario)" }), 
        { status: 400 }
      );
    }

    const nuevaPropiedad = await sql`
      INSERT INTO Propiedades (
        titulo, 
        descripcion, 
        precio, 
        direccion, 
        ciudad, 
        habitaciones, 
        baños, 
        area_m2, 
        usuario_id
      )
      VALUES (
        ${titulo}, 
        ${descripcion}, 
        ${precio}, 
        ${direccion}, 
        ${ciudad}, 
        ${habitaciones}, 
        ${baños}, 
        ${area_m2}, 
        ${usuario_id}
      )
      RETURNING *; 
    `;
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Propiedad publicada con éxito",
        data: nuevaPropiedad[0] 
      }), 
      { status: 201 }
    );

  } catch (error) {
    console.error("Error al publicar propiedad:", error.message);
    

    if (error.message.includes("violates foreign key constraint")) {
      return new Response(
        JSON.stringify({ error: "El usuario proporcionado no es válido" }), 
        { status: 400 }
      );
    }

    return new Response(
      JSON.stringify({ error: "Error interno al procesar la publicación" }), 
      { status: 500 }
    );
  }
}