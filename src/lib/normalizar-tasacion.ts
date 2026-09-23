type FilaDB = Record<string, any>;
export type TasacionNormalizada = Record<string, any>;

export function mapearDesdeDB(p: FilaDB): TasacionNormalizada {
  const supCub = Number(p.superficie_cubierta) || 0;
  const supTotal = Number(p.superficie_total) || supCub;

  let lat = p.latitud ? Number(p.latitud) : null;
  let lng = p.longitud ? Number(p.longitud) : null;

  if ((!lat || !lng) && p.coordenadas_gps) {
    try {
      const coords = typeof p.coordenadas_gps === 'string'
        ? JSON.parse(p.coordenadas_gps)
        : p.coordenadas_gps;
      lat = Number(coords.lat);
      lng = Number(coords.lng);
    } catch (e) {
      console.warn('Error parseando coordenadas_gps:', e);
    }
  }

  let det: Record<string, any> = {};
  try {
    det = typeof p.detalles === 'string' ? JSON.parse(p.detalles) : (p.detalles && typeof p.detalles === 'object' ? p.detalles : {});
  } catch { det = {}; }

  return {
    id: String(p.id_publicacion ?? p.id),
    tipoTasacion: p.tipo_operacion,
    tipo_operacion: p.tipo_operacion,
    tipoUnidad: p.tipo_propiedad ?? 'Departamento',
    direccion: p.direccion || p.titulo || 'Sin dirección',
    barrio: p.barrio || null,
    ciudad: p.ciudad || null,
    superficieCubierta: supCub,
    superficieDescubierta: Math.max(supTotal - supCub, 0),
    superficieTotal: supTotal,
    superficie_total: supTotal,
    superficie_cubierta: supCub,
    ambientes: p.ambientes ?? det.ambientes ?? null,
    dormitorios: p.dormitorios ?? det.dormitorios ?? null,
    banos: p.banos ?? det.banos ?? null,
    piso: p.piso ?? det.piso ?? null,
    antiguedad: det.antiguedad ?? null,
    orientacion: det.orientacion ?? null,
    disposicion: det.disposicion ?? null,
    estadoGeneral: det.estadoGeneral ?? null,
    expensas: Number(p.expensas) || 0,
    precioEstimadoUsd: p.precio_estimado_ia != null ? Number(p.precio_estimado_ia) : null,
    comodidades: Array.isArray(det.comodidades) ? det.comodidades : [],
    fotos: Array.isArray(det.fotos) ? det.fotos : [],
    demo: false,
    latitud: lat,
    longitud: lng,
  };
}

export function normalizeData(raw: any): TasacionNormalizada | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.id_publicacion != null) return mapearDesdeDB(raw);
  try {
    const supCub = Number(raw.superficieCubierta ?? raw.superficie_cubierta) || 0;
    const supTotal = Number(raw.superficie_total ?? raw.superficieTotal) || supCub;
    let det: Record<string, any> = {};
    try {
      det = typeof raw.detalles === 'string' ? JSON.parse(raw.detalles) : (raw.detalles && typeof raw.detalles === 'object' ? raw.detalles : {});
    } catch { det = {}; }
    return {
      id: String(raw.id ?? raw.id_publicacion ?? 'N/A'),
      tipoTasacion: raw.tipoTasacion ?? raw.tipo_operacion ?? 'venta',
      tipo_operacion: raw.tipo_operacion ?? raw.tipoTasacion ?? 'venta',
      tipoUnidad: raw.tipoUnidad ?? raw.tipo_propiedad ?? 'Departamento',
      direccion: raw.direccion || raw.titulo || 'Sin dirección',
      barrio: raw.barrio ?? det.barrio ?? null,
      ciudad: raw.ciudad ?? det.ciudad ?? 'Ciudad de Buenos Aires',
      superficieCubierta: supCub, superficieTotal: supTotal,
      superficieDescubierta: Number(raw.superficieDescubierta) || Math.max(supTotal - supCub, 0),
      superficie_total: supTotal, superficie_cubierta: supCub,
      ambientes: raw.ambientes ?? det.ambientes ?? null,
      dormitorios: raw.dormitorios ?? det.dormitorios ?? null,
      banos: raw.banos ?? det.banos ?? null, piso: raw.piso ?? det.piso ?? null,
      antiguedad: raw.antiguedad ?? det.antiguedad ?? null,
      orientacion: raw.orientacion ?? det.orientacion ?? null,
      disposicion: raw.disposicion ?? det.disposicion ?? null,
      estadoGeneral: raw.estadoGeneral ?? det.estadoGeneral ?? null,
      expensas: Number(raw.expensas) || 0,
      precioEstimadoUsd: raw.precioEstimadoUsd != null ? Number(raw.precioEstimadoUsd) : raw.precio_estimado_ia != null ? Number(raw.precio_estimado_ia) : null,
      comodidades: Array.isArray(raw.comodidades) ? raw.comodidades : (Array.isArray(det.comodidades) ? det.comodidades : []),
      fotos: Array.isArray(raw.fotos) ? raw.fotos : (Array.isArray(det.fotos) ? det.fotos : []),
      demo: Boolean(raw.demo), coordenadas: raw.coordenadas ?? null,
    };
  } catch {
    return null;
  }
}
