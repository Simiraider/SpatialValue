import React from 'react';
import { Building2 } from 'lucide-react';
import { Button } from './ui/Button';

export const Navbar = () => {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <a href="/" className="flex items-center gap-2">
            <div className="bg-primary-600 text-white p-1.5 rounded-lg">
              <Building2 className="h-5 w-5" />
            </div>
            <span className="text-xl font-semibold tracking-tight text-slate-900">Spatial Value</span>
          </a>
        </div>
        
        <nav className="hidden md:flex items-center gap-8">
          <a href="/" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">Inicio</a>
          <a href="#features" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">Características</a>
          <a href="#pricing" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">Precios</a>
        </nav>

        <div className="flex items-center gap-4">
          <a href="/login">
            <Button variant="ghost" className="hidden sm:inline-flex">Ingresar</Button>
          </a>
          <a href="/tasacion">
            <Button>Nueva Tasación</Button>
          </a>
        </div>
      </div>
    </header>
  );
};
