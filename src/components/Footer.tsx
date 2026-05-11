import React from 'react';
import { Building2 } from 'lucide-react';

export const Footer = () => {
  return (
    <footer className="bg-white border-t border-slate-200 py-12 mt-auto">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-1 md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="bg-primary-600 text-white p-1 rounded-md">
                <Building2 className="h-4 w-4" />
              </div>
              <span className="text-lg font-semibold tracking-tight text-slate-900">Spatial Value</span>
            </div>
            <p className="text-sm text-slate-500">
              Transformando la valoración inmobiliaria con tecnología avanzada y análisis preciso.
            </p>
          </div>
          
          <div>
            <h4 className="font-semibold text-slate-900 mb-4">Producto</h4>
            <ul className="space-y-2">
              <li><a href="#" className="text-sm text-slate-500 hover:text-primary-600 transition-colors">Tasación Automática</a></li>
              <li><a href="#" className="text-sm text-slate-500 hover:text-primary-600 transition-colors">Análisis de Mercado</a></li>
              <li><a href="#" className="text-sm text-slate-500 hover:text-primary-600 transition-colors">Reportes</a></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-semibold text-slate-900 mb-4">Empresa</h4>
            <ul className="space-y-2">
              <li><a href="#" className="text-sm text-slate-500 hover:text-primary-600 transition-colors">Sobre Nosotros</a></li>
              <li><a href="#" className="text-sm text-slate-500 hover:text-primary-600 transition-colors">Contacto</a></li>
              <li><a href="#" className="text-sm text-slate-500 hover:text-primary-600 transition-colors">Blog</a></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-semibold text-slate-900 mb-4">Legal</h4>
            <ul className="space-y-2">
              <li><a href="#" className="text-sm text-slate-500 hover:text-primary-600 transition-colors">Términos de Servicio</a></li>
              <li><a href="#" className="text-sm text-slate-500 hover:text-primary-600 transition-colors">Privacidad</a></li>
            </ul>
          </div>
        </div>
        
        <div className="mt-12 pt-8 border-t border-slate-200 flex flex-col md:flex-row items-center justify-between">
          <p className="text-sm text-slate-500">
            &copy; {new Date().getFullYear()} Spatial Value. Todos los derechos reservados.
          </p>
        </div>
      </div>
    </footer>
  );
};
