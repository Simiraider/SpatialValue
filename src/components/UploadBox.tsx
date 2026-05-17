import { UploadCloud } from 'lucide-react';
import '../styles/upload-box.css';

export const UploadBox = () => {
  return (
    <div className="UploadBox">
      <div className="UploadBox-inner">
        <UploadCloud className="UploadBox-icon" />
        <div className="UploadBox-row">
          <label htmlFor="file-upload" className="UploadBox-trigger">
            <span>Sube un archivo</span>
            <input id="file-upload" name="file-upload" type="file" className="sr-only" />
          </label>
          <p className="UploadBox-hint">o arrastra y suelta</p>
        </div>
        <p className="UploadBox-formats">PDF, JPG, PNG hasta 10MB</p>
      </div>
    </div>
  );
};



