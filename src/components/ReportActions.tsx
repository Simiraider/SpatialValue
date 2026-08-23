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

function estimarTamanoPdf(data: DatosInforme): string {
  const factores = [45, 25, 30, 20, 35, 15, 20, 15, 25];
  let kb = factores.reduce((a, b) => a + b, 0);
  if (Array.isArray(data.fotos) && data.fotos.length > 0) {
    kb += data.fotos.length * 50;
  }
  if (kb < 100) kb = 100;
  return kb >= 1000 ? `~${(kb / 1000).toFixed(1)} MB` : `~${Math.round(kb)} KB`;
}

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
    <div className="ReportePage-downloadGroup">
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
      {data && !generando && (
        <span className="ReportePage-downloadSize">{estimarTamanoPdf(data)}</span>
      )}
    </div>
  );
};
