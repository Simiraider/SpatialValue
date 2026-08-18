import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: typeof markerIcon === 'string' ? markerIcon : markerIcon.src,
  iconRetinaUrl: typeof markerIcon2x === 'string' ? markerIcon2x : markerIcon2x.src,
  shadowUrl: typeof markerShadow === 'string' ? markerShadow : markerShadow.src,
});

interface MapaReporteProps {
  lat?: number | null;
  lng?: number | null;
  direccion: string;
}

export const MapaReporte = ({ lat, lng, direccion }: MapaReporteProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current) return;

    const renderizarMapa = (latitude: number, longitude: number) => {
      if (mapInstance.current) {
        mapInstance.current.setView([latitude, longitude], 15);
        return;
      }

      const map = L.map(mapContainer.current!).setView([latitude, longitude], 15);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
      }).addTo(map);

      L.marker([latitude, longitude])
        .addTo(map)
        .bindPopup(`<b>${direccion}</b>`)
        .openPopup();

      mapInstance.current = map;
    };

    if (lat && lng) {
      renderizarMapa(lat, lng);
      return;
    }

    const query = `${direccion}, Ciudad Autónoma de Buenos Aires, Argentina`;
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.length > 0) {
          renderizarMapa(parseFloat(data[0].lat), parseFloat(data[0].lon));
        } else {
          renderizarMapa(-34.6037, -58.3816);
        }
      })
      .catch(() => renderizarMapa(-34.6037, -58.3816));

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [lat, lng, direccion]);

  return (
    <div 
      ref={mapContainer} 
      style={{ 
        width: '100%', 
        height: '350px', 
        borderRadius: '12px', 
        zIndex: 1, 
        marginTop: '1rem' 
      }} 
    />
  );
};