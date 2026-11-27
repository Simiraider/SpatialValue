const EDICION_KEY = 'tasacion-edicion';
const DRAFT_KEY = 'tasacion-draft';

/**
 * Prepara la edición en el formulario a partir de una tasación ya normalizada
 * (ver `normalizeData`). Conserva su estado: editar no la vuelve borrador.
 * Los valores vacíos los resuelve el propio formulario al precargar.
 */
export function prepararEdicionDeTasacion(datos: Record<string, any>): boolean {
  try {
    const id = datos.id == null ? '' : String(datos.id).trim();
    if (!id) return false;
    const lat = datos.coordenadas?.lat ?? datos.latitud;
    const lng = datos.coordenadas?.lng ?? datos.longitud;

    sessionStorage.setItem(EDICION_KEY, JSON.stringify({
      edicion: true,
      id,
      es_borrador: datos.es_borrador === true,
      tipoTasacion: datos.tipoTasacion === 'alquiler' ? 'alquiler' : 'venta',
      direccion: datos.direccion,
      barrio: datos.barrio,
      tipoUnidad: datos.tipoUnidad,
      superficieTotal: datos.superficieTotal,
      superficieCubierta: datos.superficieCubierta,
      ambientes: datos.ambientes,
      antiguedad: datos.antiguedad,
      banos: datos.banos,
      dormitorios: datos.dormitorios,
      piso: datos.piso,
      orientacion: datos.orientacion,
      disposicion: datos.disposicion,
      luzNatural: datos.luzNatural,
      comodidades: datos.comodidades,
      estadoGeneral: datos.estadoGeneral,
      expensas: datos.expensas,
      fotos: datos.fotos,
      coordenadas: lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : null,
    }));
    sessionStorage.removeItem(DRAFT_KEY);
    return true;
  } catch {
    return false;
  }
}
