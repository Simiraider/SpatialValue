import React from 'react';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { UploadBox } from './UploadBox';
import { MapPin, Home, Maximize, FileText } from 'lucide-react';

export const PropertyForm = () => {
  return (
    <form className="space-y-8" action="/dashboard" method="GET">
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium leading-6 text-slate-900 flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary-600" />
            Ubicación de la Propiedad
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Ingresa la dirección exacta para obtener comparables precisos en la zona.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
            <div className="sm:col-span-6">
              <Input label="Dirección completa" placeholder="Ej. Av. Libertador 1234, CABA" />
            </div>
            <div className="sm:col-span-2">
              <Input label="Código Postal" placeholder="Ej. 1425" />
            </div>
            <div className="sm:col-span-4">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Barrio / Zona</label>
              <select className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
                <option>Seleccionar zona...</option>
                <option>Palermo</option>
                <option>Belgrano</option>
                <option>Recoleta</option>
                <option>Puerto Madero</option>
              </select>
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-slate-200">
          <h3 className="text-lg font-medium leading-6 text-slate-900 flex items-center gap-2">
            <Home className="h-5 w-5 text-primary-600" />
            Características Principales
          </h3>
          <div className="mt-4 grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
            <div className="sm:col-span-3">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Tipo de Propiedad</label>
              <select className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
                <option>Departamento</option>
                <option>Casa</option>
                <option>PH</option>
                <option>Terreno</option>
                <option>Oficina</option>
              </select>
            </div>
            <div className="sm:col-span-3">
              <Input label="Antigüedad (años)" type="number" placeholder="Ej. 15" />
            </div>
            <div className="sm:col-span-2">
              <Input label="Superficie Total (m²)" type="number" placeholder="Ej. 120" />
            </div>
            <div className="sm:col-span-2">
              <Input label="Superficie Cubierta (m²)" type="number" placeholder="Ej. 100" />
            </div>
            <div className="sm:col-span-2">
              <Input label="Ambientes" type="number" placeholder="Ej. 4" />
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-slate-200">
          <h3 className="text-lg font-medium leading-6 text-slate-900 flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary-600" />
            Documentación (Opcional)
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Sube planos, escrituras o fotos para mejorar la precisión de la tasación.
          </p>
          <div className="mt-4">
            <UploadBox />
          </div>
        </div>
      </div>

      <div className="pt-8 flex justify-end gap-3">
        <Button variant="outline" type="button">Cancelar</Button>
        <Button type="submit">Generar Tasación</Button>
      </div>
    </form>
  );
};
