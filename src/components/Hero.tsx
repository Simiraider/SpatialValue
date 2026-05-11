import React from 'react';
import { Button } from './ui/Button';
import { ArrowRight, BarChart3, Home, MapPin } from 'lucide-react';
import { motion } from 'framer-motion';

export const Hero = () => {
  return (
    <section className="relative overflow-hidden bg-white pt-24 pb-32">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
      
      <div className="container relative mx-auto px-4 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="max-w-3xl mx-auto"
        >
          <span className="inline-block py-1 px-3 rounded-full bg-primary-50 text-primary-700 text-sm font-medium mb-6">
            Lanzamiento Sprint 1
          </span>
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-slate-900 mb-8 leading-tight">
            Tasaciones inmobiliarias <span className="text-primary-600">inteligentes</span>
          </h1>
          <p className="text-lg text-slate-600 mb-10 leading-relaxed max-w-2xl mx-auto">
            Descubre el valor real de tu propiedad en minutos con nuestra tecnología avanzada. Análisis de mercado instantáneo y reportes detallados para tomar las mejores decisiones.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="/tasacion">
              <Button size="lg" className="w-full sm:w-auto group">
                Comenzar Tasación
                <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </a>
            <a href="/dashboard">
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                Ver Dashboard Demo
              </Button>
            </a>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="mt-20 max-w-5xl mx-auto relative"
        >
          <div className="rounded-2xl border border-slate-200/60 bg-white/50 backdrop-blur-sm p-2 shadow-2xl">
            <div className="rounded-xl overflow-hidden border border-slate-100 bg-slate-50 aspect-[16/9] relative flex items-center justify-center">
              {/* Fake UI for Hero */}
              <div className="absolute inset-0 bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center">
                <div className="grid grid-cols-3 gap-6 w-full max-w-3xl p-8">
                  {[
                    { icon: MapPin, title: "Análisis de Zona", value: "+12.5%", color: "text-blue-500" },
                    { icon: Home, title: "Valor Promedio", value: "$125,000", color: "text-indigo-500" },
                    { icon: BarChart3, title: "Tendencia", value: "Alcista", color: "text-emerald-500" }
                  ].map((stat, i) => (
                    <div key={i} className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col items-center text-center">
                      <div className={`p-3 rounded-full bg-slate-50 mb-4 ${stat.color}`}>
                        <stat.icon className="h-6 w-6" />
                      </div>
                      <p className="text-sm text-slate-500 mb-1">{stat.title}</p>
                      <p className="text-xl font-bold text-slate-900">{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};
