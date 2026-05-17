import { Download, ArrowLeft } from 'lucide-react';
import { Button } from './ui/Button';

/**
 * ReportActions — botones del reporte agrupados en una sola isla React.
 * Evita anidar <button> dentro de <a> y consolida islas independientes.
 */
export const ReportActions = () => {
  return (
    <div className="ReportePage-actions">
      <Button
        variant="outline"
        onClick={() => (window.location.href = '/dashboard')}
        id="btn-volver-dashboard"
      >
        <ArrowLeft className="ReportePage-downloadIcon" aria-hidden />
        Volver al Dashboard
      </Button>
    </div>
  );
};

export const ReportDownloadButton = () => {
  const handleDownload = () => {
    // TODO: integrar generación de PDF real en un sprint posterior
    window.print();
  };

  return (
    <Button variant="outline" onClick={handleDownload} id="btn-descargar-pdf">
      <Download className="ReportePage-downloadIcon" aria-hidden />
      Descargar PDF
    </Button>
  );
};
