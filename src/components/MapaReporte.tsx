import { useEffect, useState } from 'react';

interface MapaReporteProps {
  lat?: number | null;
  lng?: number | null;
  direccion?: string;
}

export const MapaReporte = ({ lat, lng, direccion }: MapaReporteProps) => {
  const hasCoords = lat != null && lng != null && lat !== 0 && lng !== 0;
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    hasCoords ? { lat: lat!, lng: lng! } : null
  );
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (hasCoords) {
      setCoords({ lat: lat!, lng: lng! });
      return;
    }
    if (!direccion) return;

    setCargando(true);
    const query = `${direccion}, Ciudad de Buenos Aires, Argentina`;
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=ar`, {
      headers: { 'User-Agent': 'SpatialValue/1.0 (tasaciones)' },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data && data.length > 0) {
          setCoords({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) });
        }
      })
      .catch(() => {})
      .finally(() => setCargando(false));
  }, [lat, lng, direccion]);

  const mapsUrl = coords
    ? `https://www.google.com/maps?q=${coords.lat},${coords.lng}&z=15&t=h`
    : `https://www.google.com/maps?q=${encodeURIComponent(direccion || '')},Ciudad+de+Buenos+Aires&z=15&t=h`;

  const embedSrc = coords
    ? `https://maps.google.com/maps?q=${coords.lat},${coords.lng}&z=15&output=embed`
    : `https://maps.google.com/maps?q=${encodeURIComponent(direccion || '')},Ciudad+de+Buenos+Aires&z=15&output=embed`;

  if (cargando) {
    return (
      <div className="ReportePage-mapPlaceholder">
        <p style={{ color: '#94a3b8' }}>Buscando ubicación...</p>
      </div>
    );
  }

  return (
    <div style={{ borderRadius: '0.5rem', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
      <iframe
        title={`Mapa de ${direccion || 'la propiedad'}`}
        width="100%"
        height="280"
        style={{ border: 0, display: 'block' }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        src={embedSrc}
      />
      <div style={{ padding: '0.75rem', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
          {direccion || (coords ? `${coords.lat}, ${coords.lng}` : '')}
        </span>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: '0.8rem', color: '#0891b2', textDecoration: 'underline', fontWeight: 500 }}
        >
          Abrir en Google Maps ↗
        </a>
      </div>
    </div>
  );
};
