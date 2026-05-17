import { useState, useRef } from 'react';
import { UploadCloud, X, FileImage } from 'lucide-react';
import '../styles/upload-box.css';

const MAX_SIZE_MB = 10;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const ACCEPTED_EXTENSIONS = '.jpg,.jpeg,.png,.pdf';

interface FileEntry {
  name: string;
  sizeKb: number;
  previewUrl?: string;
}

export const UploadBox = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const processFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setError(null);

    const entries: FileEntry[] = [];
    for (const file of Array.from(incoming)) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError(`"${file.name}" no es un tipo permitido (JPG, PNG, PDF).`);
        return;
      }
      if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        setError(`"${file.name}" supera el límite de ${MAX_SIZE_MB} MB.`);
        return;
      }
      const previewUrl = file.type.startsWith('image/')
        ? URL.createObjectURL(file)
        : undefined;
      entries.push({ name: file.name, sizeKb: Math.round(file.size / 1024), previewUrl });
    }
    setFiles((prev) => [...prev, ...entries]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => {
      const copy = [...prev];
      if (copy[index].previewUrl) URL.revokeObjectURL(copy[index].previewUrl!);
      copy.splice(index, 1);
      return copy;
    });
  };

  return (
    <div className="UploadBox">
      <div
        className={`UploadBox-inner${dragging ? ' UploadBox-inner--dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          processFiles(e.dataTransfer.files);
        }}
      >
        <UploadCloud className="UploadBox-icon" />
        <div className="UploadBox-row">
          <label htmlFor="file-upload" className="UploadBox-trigger">
            <span>Sube un archivo</span>
            <input
              ref={inputRef}
              id="file-upload"
              name="file-upload"
              type="file"
              className="sr-only"
              accept={ACCEPTED_EXTENSIONS}
              multiple
              onChange={(e) => processFiles(e.target.files)}
            />
          </label>
          <p className="UploadBox-hint">o arrastra y suelta</p>
        </div>
        <p className="UploadBox-formats">PDF, JPG, PNG hasta {MAX_SIZE_MB} MB</p>
      </div>

      {error && <p className="UploadBox-error" role="alert">{error}</p>}

      {files.length > 0 && (
        <ul className="UploadBox-list" aria-label="Archivos seleccionados">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="UploadBox-listItem">
              {f.previewUrl ? (
                <img src={f.previewUrl} alt="" className="UploadBox-thumb" />
              ) : (
                <FileImage className="UploadBox-fileIcon" />
              )}
              <span className="UploadBox-fileName">{f.name}</span>
              <span className="UploadBox-fileSize">{f.sizeKb} KB</span>
              <button
                type="button"
                className="UploadBox-remove"
                aria-label={`Eliminar ${f.name}`}
                onClick={() => removeFile(i)}
              >
                <X className="UploadBox-removeIcon" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
