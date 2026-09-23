export const prerender = false;
import { verificarDireccion } from '../../lib/verificar-direccion';

export async function POST({ request }) {
  try {
    const { direccion, barrio, ciudad } = await request.json();

    if (!direccion || !String(direccion).trim()) {
      return new Response(
        JSON.stringify({ error: 'Falta la dirección a verificar' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const resultado = await verificarDireccion(
      String(direccion).trim(),
      barrio || null,
      ciudad || 'Ciudad de Buenos Aires'
    );

    return new Response(JSON.stringify({ success: true, data: resultado }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error al verificar dirección:', error.message);
    return new Response(
      JSON.stringify({ error: 'Error al verificar la dirección' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
