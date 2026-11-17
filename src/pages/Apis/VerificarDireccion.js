export const prerender = false;
import { verificarDireccion, canonizarBarrio } from '../../lib/verificar-direccion';
import { ipDePeticion, esMismoOrigen } from '../../Backend/sesion.js';
import { permitirFrecuencia } from '../../Backend/limite.js';

export async function POST({ request }) {
  try {
    if (!esMismoOrigen(request)) {
      return new Response(
        JSON.stringify({ error: 'Origen no permitido.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!(await permitirFrecuencia(`verificar-direccion:${ipDePeticion(request)}`, 12, 60_000))) {
      return new Response(
        JSON.stringify({ error: 'Demasiadas verificaciones. Esperá un minuto.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

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

    return new Response(JSON.stringify({
      success: true,
      data: { ...resultado, barrioCanonizado: canonizarBarrio(resultado.barrioDetectado) },
    }), {
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
