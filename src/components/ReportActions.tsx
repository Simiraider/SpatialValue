import { useState } from 'react';
import { Download, ArrowLeft } from 'lucide-react';
import { Button } from './ui/Button';
import { generarInformePdf, type DatosInforme } from '../lib/generar-pdf';


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

type ReportDownloadButtonProps = {
  data?: DatosInforme;
  cliente?: string;
};

export const ReportDownloadButton = ({ data, cliente }: ReportDownloadButtonProps) => {
  const [generando, setGenerando] = useState(false);

  const handleDownload = async () => {
    if (!data) return;
    setGenerando(true);
    try {
      await generarInformePdf(data, cliente);
    } catch (error) {
      console.error('Error al generar el PDF', error);
      alert('No se pudo generar el PDF. Intentá de nuevo.');
    } finally {
      setGenerando(false);
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleDownload}
      disabled={!data || generando}
      isLoading={generando}
      id="btn-descargar-pdf"
    >
      <Download className="ReportePage-downloadIcon" aria-hidden />
      {generando ? 'Generando PDF...' : 'Descargar PDF'}
    </Button>
  );
};
