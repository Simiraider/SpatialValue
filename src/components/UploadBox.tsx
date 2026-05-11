import React from 'react';
import { UploadCloud, FileType } from 'lucide-react';

export const UploadBox = () => {
  return (
    <div className="mt-2 flex justify-center rounded-xl border border-dashed border-slate-300 px-6 py-10 hover:border-primary-500 hover:bg-primary-50/50 transition-colors cursor-pointer bg-white">
      <div className="text-center">
        <UploadCloud className="mx-auto h-12 w-12 text-slate-400" />
        <div className="mt-4 flex text-sm leading-6 text-slate-600 justify-center">
          <label
            htmlFor="file-upload"
            className="relative cursor-pointer rounded-md bg-transparent font-semibold text-primary-600 focus-within:outline-none focus-within:ring-2 focus-within:ring-primary-600 focus-within:ring-offset-2 hover:text-primary-500"
          >
            <span>Sube un archivo</span>
            <input id="file-upload" name="file-upload" type="file" className="sr-only" />
          </label>
          <p className="pl-1">o arrastra y suelta</p>
        </div>
        <p className="text-xs leading-5 text-slate-500">PDF, JPG, PNG hasta 10MB</p>
      </div>
    </div>
  );
};
