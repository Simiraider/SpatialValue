import { Download, ArrowLeft } from 'lucide-react';
import { Button } from './ui/Button';


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
    window.print();
  };

  return (
    <Button variant="outline" onClick={handleDownload} id="btn-descargar-pdf">
      <Download className="ReportePage-downloadIcon" aria-hidden />
      Descargar PDF
    </Button>
  );
};
