interface MapaReporteProps {
  lat?: number | null;
  lng?: number | null;
  direccion?: string;
}

export const MapaReporte = ({ lat, lng, direccion }: MapaReporteProps) => {
  const hasCoords = lat != null && lng != null && lat !== 0 && lng !== 0;

  if (!hasCoords) {
    return (
      <div className="ReportePage-mapPlaceholder">
        <p>Coordenadas no disponibles para {direccion || 'esta propiedad'}.</p>
      </div>
    );
  }

  const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}&z=15&t=h`;

  return (
    <div className="ReportePage-mapPlaceholder" style={{ flexDirection: 'column', gap: '0.75rem' }}>
      <iframe
        title={`Mapa de ${direccion || 'la propiedad'}`}
        width="100%"
        height="260"
        style={{ border: 0, borderRadius: '0.5rem' }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        src={`https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3283.${Math.round(lng! * 1000)}!2d${lng}!3d${lat}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2z${lat},${lng}!5e0!3m2!1ses!2sar!4v1`}
      />
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontSize: '0.8rem', color: '#0891b2', textDecoration: 'underline' }}
      >
        Abrir en Google Maps
      </a>
    </div>
  );
};
