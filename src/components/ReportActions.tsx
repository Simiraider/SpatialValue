import { Download, Plus } from 'lucide-react';
import { Button } from './ui/Button';
import { navigate } from '../lib/navigate';

export const ReportActions = () => {
  return (
    <div className="rpt-actions">
      <Button
        variant="outline"
        onClick={() => navigate('/formulario')}
      >
        <Plus size={16} style={{marginRight: '0.4rem'}} />
        Nueva Tasación
      </Button>
    </div>
  );
};

export const ReportDownloadButton = () => {
  const handleDownload = () => {
    window.print();
  };

  return (
    <Button
      variant="outline"
      onClick={handleDownload}
      style={{width: '100%', justifyContent: 'center'}}
    >
      <Download size={16} style={{marginRight: '0.4rem'}} />
      Descargar PDF
    </Button>
  );
};
