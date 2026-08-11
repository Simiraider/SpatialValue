/**
 * Calidad estimada del gemelo digital según la cantidad de fotos.
 * Basado en las recomendaciones de COLMAP (cada objeto debe aparecer en ≥3 fotos).
 * Mantener sincronizado con src/lib/gemelo.ts (frontend).
 *
 * Rangos (asumidos a partir de la especificación):
 *   5–14  → aproximado   ("Tu modelo 3D será aproximado")
 *   15–29 → moderado     ("modelo 3D moderado")
 *   30–59 → bueno        ("buena fidelidad")
 *   ≥60   → alto         ("alta fidelidad")
 */

export function calidadPorFotos(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) {
    return {
      clave: 'invalido',
      etiqueta: 'Sin fotos',
      mensaje: 'Subí fotos de la propiedad para generar el gemelo digital.',
      nivel: 0,
    };
  }
  if (num < 5) {
    return {
      clave: 'insuficiente',
      etiqueta: 'Insuficiente',
      mensaje: 'Se necesitan al menos 5 fotos para generar el gemelo digital.',
      nivel: 0,
    };
  }
  if (num <= 14) {
    return {
      clave: 'aproximado',
      etiqueta: 'Aproximado',
      mensaje:
        'Tu modelo 3D será aproximado: con 5–15 fotos la geometría se reconstruye de forma parcial. Sumá más fotos con buen solapamiento (cada zona en al menos 3 fotos).',
      nivel: 1,
    };
  }
  if (num <= 29) {
    return {
      clave: 'moderado',
      etiqueta: 'Moderado',
      mensaje:
        'Modelo 3D moderado: con 15–30 fotos vas a capturar la mayor parte de la geometría, aunque con algunas zonas imprecisas.',
      nivel: 2,
    };
  }
  if (num <= 59) {
    return {
      clave: 'bueno',
      etiqueta: 'Buena fidelidad',
      mensaje:
        'Buena fidelidad: con 30–60 fotos el modelo captura bien el espacio y los detalles principales.',
      nivel: 3,
    };
  }
  return {
    clave: 'alto',
    etiqueta: 'Alta fidelidad',
    mensaje:
      'Alta fidelidad: con más de 60 fotos podés lograr un gemelo digital detallado del inmueble.',
    nivel: 4,
  };
}
