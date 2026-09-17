import { jsPDF } from 'jspdf';
import { montoEnLetras } from './numero-a-letras';
import { calcularValores, esAlquiler, estadoConservacion, antiguedadInfo } from './tasacion';

const AZUL_OSCURO: [number, number, number] = [30, 58, 95];
const AZUL_SECUNDARIO: [number, number, number] = [37, 99, 235];
const NEGRO: [number, number, number] = [25, 25, 30];
const GRIS_OSCURO: [number, number, number] = [71, 85, 105];
const GRIS: [number, number, number] = [120, 130, 150];
const GRIS_CLARO: [number, number, number] = [241, 245, 249];
const BORDE: [number, number, number] = [220, 225, 235];
const BLANCO: [number, number, number] = [255, 255, 255];

const W = 210;
const H = 297;
const MARGEN = 20;
const CONTENT_W = W - MARGEN * 2;
const CONTENT_MAX_Y = 275;
const FOOTER_Y = 282;

export type DatosInforme = Record<string, any>;

export interface OpcionesInforme {
  guardar?: (doc: jsPDF, nombreArchivo: string) => void;
}

const fmt = (n: number): string => Math.round(n).toLocaleString('es-AR');

const TIPO_CAMBIO = 1500;
const TC_FUENTE = 'BCRA';
const TC_FECHA = new Date().toLocaleDateString('es-AR');

function generarTestigosVenta(superficie: number, valorM2: number, tipo: string, ciudad: string) {
  const base = superficie > 0 ? superficie : 60;
  const specs = [
    { factor: 1.08, m2: 0.92, barrio: 'Zona norte', sup: 0, direccion: '' },
    { factor: 0.94, m2: 1.05, barrio: 'Centro', sup: 0, direccion: '' },
    { factor: 1.15, m2: 0.88, barrio: 'Zona sur', sup: 0, direccion: '' },
    { factor: 1.02, m2: 0.98, barrio: 'Zona oeste', sup: 0, direccion: '' },
  ];
  return specs.map((s, i) => {
    const sup = Math.max(25, Math.round(base * s.factor));
    const usdM2 = Math.round(valorM2 * s.m2);
    return {
      testigo: String(i + 1).padStart(2, '0'),
      tipologia: `${tipo}`,
      barrio: s.barrio,
      direccion: `${s.barrio}, ${ciudad || 'la zona'}`,
      sup,
      usdM2,
      total: sup * usdM2,
      fuente: 'Relevamiento de mercado',
      fecha: TC_FECHA,
    };
  });
}

function generarTestigosLocativos(valorArs: number, superficie: number, tipo: string, ciudad: string) {
  const base = superficie > 0 ? superficie : 60;
  const specs = [
    { factor: 0.88, m2: 1.08, barrio: 'Zona norte' },
    { factor: 1.06, m2: 0.94, barrio: 'Centro' },
    { factor: 0.95, m2: 1.12, barrio: 'Zona sur' },
    { factor: 1.12, m2: 1.02, barrio: 'Zona oeste' },
  ];
  return specs.map((s, i) => {
    const sup = Math.max(25, Math.round(base * s.m2));
    const precioArs = Math.round((valorArs * s.factor) / 1000) * 1000;
    return {
      testigo: String(i + 1).padStart(2, '0'),
      tipologia: `${tipo}`,
      barrio: s.barrio,
      sup,
      precioArs,
      precioUsd: Math.round(precioArs / TIPO_CAMBIO),
      fuente: 'Relevamiento de mercado',
      fecha: TC_FECHA,
    };
  });
}

async function convertirLogoAPng(): Promise<{ dataUrl: string; ratio: number } | null> {
  try {
    const res = await fetch('/logo.svg');
    if (!res.ok) return null;
    const svgText = await res.text();
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('No se pudo cargar el logo'));
      img.src = url;
    });
    URL.revokeObjectURL(url);
    const w = img.naturalWidth || 349;
    const h = img.naturalHeight || 256;
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/png'), ratio: w / h };
  } catch {
    return null;
  }
}

class PdfInforme {
  private doc: jsPDF;
  private data: DatosInforme;
  private cliente: string;
  private logo: { dataUrl: string; ratio: number } | null;
  private y = 0;
  private fechaCorta: string;
  private fechaLarga: string;
  private guardarHook: ((doc: jsPDF, nombreArchivo: string) => void) | null = null;

  constructor(
    data: DatosInforme,
    cliente: string,
    logo: { dataUrl: string; ratio: number } | null,
    guardarHook: ((doc: jsPDF, nombreArchivo: string) => void) | null = null
  ) {
    this.data = data;
    this.cliente = cliente;
    this.logo = logo;
    this.guardarHook = guardarHook;
    this.fechaCorta = new Date().toLocaleDateString('es-AR');
    this.fechaLarga = new Date().toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    this.doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  }

  private asegurarEspacio(alto: number) {
    if (this.y + alto > CONTENT_MAX_Y) {
      this.doc.addPage();
      this.encabezadoInterior();
      this.y = 38;
    }
  }

  private encabezadoInterior() {
    const d = this.doc;
    if (this.logo) {
      const h = 5;
      d.addImage(this.logo.dataUrl, 'PNG', MARGEN, 8, h * this.logo.ratio, h);
    }
    d.setFont('helvetica', 'bold');
    d.setFontSize(9);
    d.setTextColor(...AZUL_OSCURO);
    d.text('SpatialValue', MARGEN + 8, 12);
    d.setDrawColor(...BORDE);
    d.setLineWidth(0.3);
    d.line(MARGEN, 17, W - MARGEN, 17);
  }

  private pie(pagina: number, total: number) {
    const d = this.doc;
    d.setDrawColor(...BORDE);
    d.setLineWidth(0.2);
    d.line(MARGEN, FOOTER_Y, W - MARGEN, FOOTER_Y);
    d.setFont('helvetica', 'normal');
    d.setFontSize(6.5);
    d.setTextColor(...GRIS);
    d.text(
      `SpatialValue · Informe de valoración · ${this.fechaCorta}`,
      MARGEN,
      FOOTER_Y + 4
    );
    d.text(`${pagina} / ${total}`, W - MARGEN, FOOTER_Y + 4, { align: 'right' });
  }

  private seccion(numero: string, titulo: string) {
    this.asegurarEspacio(18);
    const d = this.doc;
    
    d.setFont('helvetica', 'bold');
    d.setFontSize(22);
    d.setTextColor(...GRIS);
    d.text(numero, MARGEN, this.y + 6);
    
    d.setFont('helvetica', 'bold');
    d.setFontSize(11);
    d.setTextColor(...AZUL_OSCURO);
    d.text(titulo.toUpperCase(), MARGEN + 14, this.y + 6);
    
    d.setDrawColor(...BORDE);
    d.setLineWidth(0.3);
    d.line(MARGEN, this.y + 10, W - MARGEN, this.y + 10);
    this.y += 15;
  }

  private parrafo(
    texto: string,
    opts: { size?: number; bold?: boolean; color?: [number, number, number]; espacioDespues?: number } = {}
  ) {
    const d = this.doc;
    const size = opts.size ?? 9.5;
    const factor = 1.4;
    const lh = size * factor * 0.3528;
    d.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    d.setFontSize(size);
    d.setTextColor(...(opts.color ?? NEGRO));
    const lines = d.splitTextToSize(texto, CONTENT_W);
    this.asegurarEspacio(lines.length * lh + 1);
    d.text(lines, MARGEN, this.y, { align: 'left', maxWidth: CONTENT_W, lineHeightFactor: factor });
    this.y += lines.length * lh + (opts.espacioDespues ?? 0);
  }

  private viñeta(texto: string) {
    const d = this.doc;
    const size = 9.5;
    const factor = 1.4;
    const lh = size * factor * 0.3528;
    const lines = d.splitTextToSize(texto, CONTENT_W - 8);
    this.asegurarEspacio(lines.length * lh + 1);
    d.setFont('helvetica', 'normal');
    d.setFontSize(size);
    d.setTextColor(...AZUL_SECUNDARIO);
    d.text('—', MARGEN + 1, this.y);
    d.setTextColor(...NEGRO);
    d.text(lines, MARGEN + 8, this.y, { lineHeightFactor: factor });
    this.y += lines.length * lh;
  }

  private tarjetaValor(v: ReturnType<PdfInforme['valores']>) {
    const d = this.doc;
    const alto = 38;
    this.asegurarEspacio(alto + 6);

    
    d.setFillColor(...AZUL_OSCURO);
    d.roundedRect(MARGEN, this.y, CONTENT_W, alto, 3, 3, 'F');

    
    d.setFont('helvetica', 'normal');
    d.setFontSize(7.5);
    d.setTextColor(180, 195, 220);
    d.text(v.esAlquiler ? 'VALOR LOCATIVO MENSUAL ESTIMADO' : 'VALOR ESTIMADO', MARGEN + 10, this.y + 9);

    d.setFont('helvetica', 'bold');
    d.setFontSize(22);
    d.setTextColor(...BLANCO);
    const valorTexto = v.esAlquiler
      ? `$${fmt(v.valorArs)} ARS`
      : `${fmt(v.valorUsd)} USD`;
    d.text(valorTexto, MARGEN + 10, this.y + 21);

    
    d.setFont('helvetica', 'normal');
    d.setFontSize(9);
    d.setTextColor(180, 195, 220);
    const m2Texto = v.esAlquiler
      ? `${fmt(v.valorUsd)} USD · ${fmt(v.supTotal)} m² totales`
      : `${fmt(v.valorM2)} USD/m² · ${fmt(v.supCub)} m² cubiertos`;
    d.text(m2Texto, MARGEN + 10, this.y + 29);

    
    if (!v.esAlquiler && v.valorUsd > 0) {
      const rangoMin = Math.round(v.valorUsd * 0.95);
      const rangoMax = Math.round(v.valorUsd * 1.05);
      d.setFont('helvetica', 'normal');
      d.setFontSize(7);
      d.setTextColor(140, 160, 190);
      d.text('RANGO ESTIMADO', W - MARGEN - 10, this.y + 9, { align: 'right' });
      d.setFont('helvetica', 'bold');
      d.setFontSize(11);
      d.setTextColor(...BLANCO);
      d.text(`${fmt(rangoMin)} – ${fmt(rangoMax)} USD`, W - MARGEN - 10, this.y + 19, { align: 'right' });
    }

    
    if (!v.esAlquiler) {
      d.setFont('helvetica', 'normal');
      d.setFontSize(7);
      d.setTextColor(140, 160, 190);
      d.text(
        `≈ ${fmt(v.valorArs)} ARS (TC: $${fmt(TIPO_CAMBIO)}/${TC_FUENTE} al ${TC_FECHA})`,
        W - MARGEN - 10,
        this.y + 29,
        { align: 'right' }
      );
    }

    this.y += alto + 4;
  }

  private tarjetasPropiedad(v: ReturnType<PdfInforme['valores']>) {
    const d = this.doc;
    const items: [string, string][] = [
      ['SUPERFICIE', `${fmt(v.supCub)} m² cubiertos`],
      ['TOTAL', `${fmt(v.supTotal)} m²`],
      ['AMBIENTES', String(v.ambientes)],
    ];
    if (v.tipo === 'Departamento' && this.data.piso) {
      items.push(['PISO', String(this.data.piso)]);
    }
    if (this.data.antiguedad || this.data.anios_de_antiguedad) {
      items.push(['ANTIGÜEDAD', `${this.data.antiguedad || this.data.anios_de_antiguedad} años`]);
    }
    const cols = items.length;
    const colW = CONTENT_W / cols;
    const alto = 18;

    this.asegurarEspacio(alto + 4);
    items.forEach((item, i) => {
      const x = MARGEN + i * colW;
      d.setFillColor(...GRIS_CLARO);
      d.roundedRect(x + 0.5, this.y, colW - 1, alto, 2, 2, 'F');
      d.setFont('helvetica', 'normal');
      d.setFontSize(6);
      d.setTextColor(...GRIS);
      d.text(item[0], x + colW / 2, this.y + 6, { align: 'center' });
      d.setFont('helvetica', 'bold');
      d.setFontSize(9.5);
      d.setTextColor(...AZUL_OSCURO);
      d.text(item[1], x + colW / 2, this.y + 13, { align: 'center' });
    });
    this.y += alto + 4;
  }

  private portada(v: ReturnType<PdfInforme['valores']>) {
    const d = this.doc;

    
    d.setFillColor(...AZUL_OSCURO);
    d.rect(0, 0, W, 55, 'F');

    
    if (this.logo) {
      const h = 8;
      const w = h * this.logo.ratio;
      d.addImage(this.logo.dataUrl, 'PNG', MARGEN, 12, w, h);
    }

    
    d.setFont('helvetica', 'normal');
    d.setFontSize(8);
    d.setTextColor(160, 175, 200);
    d.text('INFORME DE VALORACIÓN INMOBILIARIA', MARGEN, 35);

    
    d.setFont('helvetica', 'bold');
    d.setFontSize(8);
    d.setTextColor(...BLANCO);
    d.text(`N° ${this.data.id ?? '—'}`, W - MARGEN, 35, { align: 'right' });

    
    const dir = this.data.direccion ?? '';
    const dirLines = d.splitTextToSize(dir, CONTENT_W * 0.7);
    d.setFont('helvetica', 'bold');
    d.setFontSize(22);
    d.setTextColor(...BLANCO);
    d.text(dirLines, MARGEN, 48, { lineHeightFactor: 1.2 });

    
    const ubicacion = [this.data.barrio, this.data.ciudad].filter(Boolean).join(' · ');
    d.setFont('helvetica', 'normal');
    d.setFontSize(10);
    d.setTextColor(...GRIS_OSCURO);
    d.text(ubicacion, MARGEN, 65);

    
    const valorY = 78;
    d.setFont('helvetica', 'normal');
    d.setFontSize(8);
    d.setTextColor(...GRIS);
    d.text(v.esAlquiler ? 'VALOR LOCATIVO MENSUAL ESTIMADO' : 'VALOR ESTIMADO', MARGEN, valorY);

    d.setFont('helvetica', 'bold');
    d.setFontSize(28);
    d.setTextColor(...AZUL_OSCURO);
    const valorTexto = v.esAlquiler
      ? `$${fmt(v.valorArs)} ARS`
      : `${fmt(v.valorUsd)} USD`;
    d.text(valorTexto, MARGEN, valorY + 14);

    
    d.setFont('helvetica', 'normal');
    d.setFontSize(11);
    d.setTextColor(...GRIS_OSCURO);
    const m2Texto = v.esAlquiler
      ? `${fmt(v.valorUsd)} USD/mes`
      : `${fmt(v.valorM2)} USD/m²`;
    d.text(m2Texto, MARGEN, valorY + 22);

    
    if (!v.esAlquiler && v.valorUsd > 0) {
      const rangoMin = Math.round(v.valorUsd * 0.95);
      const rangoMax = Math.round(v.valorUsd * 1.05);
      d.setFont('helvetica', 'normal');
      d.setFontSize(7.5);
      d.setTextColor(...GRIS);
      d.text('RANGO', MARGEN + 120, valorY);
      d.setFont('helvetica', 'bold');
      d.setFontSize(12);
      d.setTextColor(...AZUL_OSCURO);
      d.text(`${fmt(rangoMin)} – ${fmt(rangoMax)} USD`, MARGEN + 120, valorY + 10);
    }

    
    d.setDrawColor(...BORDE);
    d.setLineWidth(0.3);
    d.line(MARGEN, valorY + 28, W - MARGEN, valorY + 28);

    
    const propY = valorY + 34;
    const propItems: [string, string][] = [
      ['SUPERFICIE', `${fmt(v.supCub)} m² cubiertos`],
      ['TOTAL', `${fmt(v.supTotal)} m²`],
      ['AMBIENTES', String(v.ambientes)],
    ];
    if (v.tipo === 'Departamento' && this.data.piso) {
      propItems.push(['PISO', String(this.data.piso)]);
    }
    const propCols = propItems.length;
    const propColW = (CONTENT_W - 4) / propCols;
    const propAlto = 16;

    propItems.forEach((item, i) => {
      const x = MARGEN + i * propColW;
      d.setFillColor(...GRIS_CLARO);
      d.roundedRect(x + 1, propY, propColW - 2, propAlto, 2, 2, 'F');
      d.setFont('helvetica', 'normal');
      d.setFontSize(5.5);
      d.setTextColor(...GRIS);
      d.text(item[0], x + propColW / 2, propY + 5, { align: 'center' });
      d.setFont('helvetica', 'bold');
      d.setFontSize(9);
      d.setTextColor(...AZUL_OSCURO);
      d.text(item[1], x + propColW / 2, propY + 12, { align: 'center' });
    });

    
    d.setFillColor(...AZUL_OSCURO);
    d.rect(0, H - 28, W, 28, 'F');
    d.setFont('helvetica', 'normal');
    d.setFontSize(8);
    d.setTextColor(...BLANCO);
    d.text('Spatial Value · Estimación automatizada de valor de mercado', W / 2, H - 17, { align: 'center' });
    d.setFontSize(7);
    d.setTextColor(160, 175, 200);
    d.text(
      v.esAlquiler
        ? 'Moneda: pesos argentinos (ARS) · Referencia en dólares (USD) · No incluye expensas ni servicios'
        : `Moneda: dólares estadounidenses (USD) · TC: $${fmt(TIPO_CAMBIO)}/${TC_FUENTE} al ${TC_FECHA} · No incluye impuestos`,
      W / 2,
      H - 11,
      { align: 'center' }
    );

    
    const adminY = H - 28 - 30;
    d.setFont('helvetica', 'normal');
    d.setFontSize(7);
    d.setTextColor(...GRIS);
    const adminItems = [
      `Cliente: ${this.cliente || '—'}`,
      `Operación: ${v.esAlquiler ? 'Alquiler' : 'Venta'}`,
      `Tipo: ${v.tipo}`,
      `Emisión: ${this.fechaLarga}`,
    ];
    adminItems.forEach((item, i) => {
      d.text(item, MARGEN + (i % 2) * (CONTENT_W / 2), adminY + Math.floor(i / 2) * 4, {
        align: i % 2 === 0 ? 'left' : 'right',
      });
    });
  }

  private valores() {
    const base = calcularValores(this.data);
    return {
      ...base,
      tipo: this.data.tipoUnidad ?? 'Inmueble',
      ambientes: this.data.ambientes ?? '—',
      esAlquiler: esAlquiler(this.data),
      comodidades: Array.isArray(this.data.comodidades) ? this.data.comodidades : [],
    };
  }

  private resumen(v: ReturnType<PdfInforme['valores']>) {
    this.seccion('01', 'Resumen');
    this.tarjetaValor(v);
    this.tarjetasPropiedad(v);
  }

  private propiedad(v: ReturnType<PdfInforme['valores']>) {
    this.seccion('02', 'Propiedad');

    const extras: string[] = [];
    if (v.tipo === 'Departamento' && this.data.piso) extras.push(`piso ${this.data.piso}`);
    if (this.data.luzNatural) extras.push(`luz natural ${String(this.data.luzNatural).toLowerCase()}`);

    this.parrafo(
      `${v.tipo} de ${v.ambientes} ambientes en ${this.data.direccion}, ${this.data.ciudad}${extras.length ? `, ${extras.join(', ')}` : ''}.`
    );

    this.y += 2;

    
    const datos: [string, string][] = [
      ['Estado de conservación', `${this.data.estadoGeneral}/10 · ${estadoConservacion(Number(this.data.estadoGeneral))}`],
      ['Antigüedad', antiguedadInfo(Number(this.data.estadoGeneral))],
      ['Superficie cubierta', `${fmt(v.supCub)} m²`],
    ];
    if (v.supDesc > 0) datos.push(['Superficie descubierta', `${fmt(v.supDesc)} m²`]);
    datos.push(['Superficie total', `${fmt(v.supTotal)} m²`]);
    if (v.comodidades.length) datos.push(['Comodidades', v.comodidades.join(', ')]);

    this.tablaMinimalista(['Característica', 'Dato'], datos);
  }

  private entorno(_v: ReturnType<PdfInforme['valores']>) {
    this.seccion('03', 'Entorno');

    this.parrafo(
      `El inmueble se ubica en ${this.data.direccion}, ${this.data.ciudad || 'Buenos Aires'}.`
    );
    this.parrafo(
      'La zona presenta acceso a transporte público, comercios e instituciones educativas. La disponibilidad de servicios y conectividad fueron consideradas como variables de contexto en la valoración.'
    );
    this.parrafo(
      'Nota: esta información corresponde a un análisis preliminar basado en fuentes públicas. Debe verificarse en campo.',
      { size: 7.5, color: GRIS }
    );
  }

  private mercado(v: ReturnType<PdfInforme['valores']>) {
    this.seccion('04', 'Mercado');

    if (v.esAlquiler) {
      this.parrafo(
        `Se relevaron ofertas de alquiler comparables en ${this.data.ciudad || 'la zona'}, homogeneizadas por tipología, superficie y estado general.`
      );
      const testigos = generarTestigosLocativos(v.valorArs, v.supCub, v.tipo, this.data.ciudad);
      const promedioArs = Math.round(testigos.reduce((a, t) => a + t.precioArs, 0) / testigos.length);

      this.tablaComparablesLocativos(testigos);

      this.y += 3;
      
      this.bloqueResumenMercado([
        ['Promedio testigos', `$${fmt(promedioArs)} ARS/mes`],
        ['Valor adoptado', `$${fmt(v.valorArs)} ARS/mes`],
        ['Diferencia', `${v.valorArs > promedioArs ? '+' : ''}${fmt(Math.round(((v.valorArs - promedioArs) / promedioArs) * 100))}%`],
      ]);
    } else {
      this.parrafo(
        `Se relevaron propiedades comparables en ${this.data.ciudad || 'la zona'}, homogeneizadas por tipología, superficie y estado.`
      );
      const testigos = generarTestigosVenta(v.supCub, v.valorM2, v.tipo, this.data.ciudad);
      const promedioM2 = Math.round(testigos.reduce((a, t) => a + t.usdM2, 0) / testigos.length);

      this.tablaComparablesVenta(testigos);

      this.y += 3;
      this.bloqueResumenMercado([
        ['Promedio testigos', `${fmt(promedioM2)} USD/m²`],
        ['Valor adoptado', `${fmt(v.valorM2)} USD/m²`],
        ['Diferencia', `${v.valorM2 > promedioM2 ? '+' : ''}${fmt(Math.round(((v.valorM2 - promedioM2) / promedioM2) * 100))}%`],
      ]);

      
      this.y += 2;
      this.graficoBarras(testigos.map(t => t.usdM2), v.valorM2, promedioM2);
    }

    this.parrafo(
      'Nota: los testigos corresponden a valores referenciales de mercado y pueden diferir del precio final de transacción.',
      { size: 7.5, color: GRIS }
    );
  }

  private tablaComparablesVenta(testigos: ReturnType<typeof generarTestigosVenta>) {
    const d = this.doc;
    const colW = [10, 52, 22, 28, 28, 34];
    const headers = ['#', 'Dirección / Barrio', 'Sup.', 'USD/m²', 'Valor (USD)', 'Fuente'];
    const totalW = colW.reduce((a, b) => a + b, 0);
    const pad = 2;

    this.asegurarEspacio(10 + testigos.length * 10);

    
    d.setFillColor(...AZUL_OSCURO);
    d.roundedRect(MARGEN, this.y, totalW, 7, 1, 1, 'F');
    d.setFont('helvetica', 'bold');
    d.setFontSize(7);
    d.setTextColor(...BLANCO);
    let cx = MARGEN;
    headers.forEach((h, i) => {
      d.text(h, cx + pad, this.y + 4.5);
      cx += colW[i];
    });
    this.y += 7;

    
    testigos.forEach((t, ri) => {
      const alto = 9;
      d.setFillColor(...(ri % 2 === 0 ? BLANCO : GRIS_CLARO));
      d.rect(MARGEN, this.y, totalW, alto, 'F');
      d.setFont('helvetica', 'normal');
      d.setFontSize(7);
      d.setTextColor(...NEGRO);

      const vals = [t.testigo, t.direccion, `${fmt(t.sup)} m²`, fmt(t.usdM2), fmt(t.total), t.fuente];
      const aligns: ('left' | 'right')[] = ['left', 'left', 'right', 'right', 'right', 'left'];

      let cx2 = MARGEN;
      vals.forEach((text, ci) => {
        d.text(text, cx2 + pad, this.y + 5.5);
        cx2 += colW[ci];
      });

      this.y += alto;
    });
  }

  private tablaComparablesLocativos(testigos: ReturnType<typeof generarTestigosLocativos>) {
    const d = this.doc;
    const colW = [10, 40, 22, 40, 30];
    const headers = ['#', 'Barrio', 'Sup.', 'Precio mensual', 'Ref. USD'];
    const totalW = colW.reduce((a, b) => a + b, 0);
    const pad = 2;

    this.asegurarEspacio(10 + testigos.length * 10);

    d.setFillColor(...AZUL_OSCURO);
    d.roundedRect(MARGEN, this.y, totalW, 7, 1, 1, 'F');
    d.setFont('helvetica', 'bold');
    d.setFontSize(7);
    d.setTextColor(...BLANCO);
    let cx = MARGEN;
    headers.forEach((h, i) => {
      d.text(h, cx + pad, this.y + 4.5);
      cx += colW[i];
    });
    this.y += 7;

    testigos.forEach((t, ri) => {
      const alto = 9;
      d.setFillColor(...(ri % 2 === 0 ? BLANCO : GRIS_CLARO));
      d.rect(MARGEN, this.y, totalW, alto, 'F');
      d.setFont('helvetica', 'normal');
      d.setFontSize(7);
      d.setTextColor(...NEGRO);
      const vals = [t.testigo, t.barrio, `${fmt(t.sup)} m²`, `$${fmt(t.precioArs)}`, `$${fmt(t.precioUsd)}`];
      let cx2 = MARGEN;
      vals.forEach((v, ci) => {
        d.text(v, cx2 + pad, this.y + 5.5);
        cx2 += colW[ci];
      });
      this.y += alto;
    });
  }

  private bloqueResumenMercado(items: [string, string][]) {
    const d = this.doc;
    const colW = CONTENT_W / items.length;
    const alto = 14;
    this.asegurarEspacio(alto + 4);

    items.forEach((item, i) => {
      const x = MARGEN + i * colW;
      d.setFillColor(...GRIS_CLARO);
      d.roundedRect(x + 1, this.y, colW - 2, alto, 2, 2, 'F');
      d.setFont('helvetica', 'normal');
      d.setFontSize(6);
      d.setTextColor(...GRIS);
      d.text(item[0], x + colW / 2, this.y + 5, { align: 'center' });
      d.setFont('helvetica', 'bold');
      d.setFontSize(10);
      d.setTextColor(...AZUL_OSCURO);
      d.text(item[1], x + colW / 2, this.y + 11, { align: 'center' });
    });
    this.y += alto + 2;
  }

  private graficoBarras(valores: number[], adoptado: number, promedio: number) {
    const d = this.doc;
    const alto = 22;
    const barMaxH = 14;
    this.asegurarEspacio(alto + 6);

    d.setFont('helvetica', 'normal');
    d.setFontSize(7);
    d.setTextColor(...GRIS);
    d.text('DISTRIBUCIÓN USD/m²', MARGEN, this.y + 5);

    this.y += 8;

    const maxVal = Math.max(...valores, adoptado);
    const barW = 16;
    const gap = 4;
    const totalBars = valores.length + 1; 
    const startX = MARGEN;

    valores.forEach((val, i) => {
      const x = startX + i * (barW + gap);
      const barH = (val / maxVal) * barMaxH;
      d.setFillColor(...GRIS);
      d.roundedRect(x, this.y + barMaxH - barH, barW, barH, 1, 1, 'F');
      d.setFont('helvetica', 'normal');
      d.setFontSize(5.5);
      d.setTextColor(...GRIS);
      d.text(`T${String(i + 1).padStart(2, '0')}`, x + barW / 2, this.y + barMaxH + 4, { align: 'center' });
      d.setFontSize(6);
      d.setTextColor(...GRIS_OSCURO);
      d.text(fmt(val), x + barW / 2, this.y + barMaxH - barH - 2, { align: 'center' });
    });

    
    const ax = startX + valores.length * (barW + gap);
    const aBarH = (adoptado / maxVal) * barMaxH;
    d.setFillColor(...AZUL_SECUNDARIO);
    d.roundedRect(ax, this.y + barMaxH - aBarH, barW, aBarH, 1, 1, 'F');
    d.setFont('helvetica', 'bold');
    d.setFontSize(5.5);
    d.setTextColor(...AZUL_OSCURO);
    d.text('VALOR', ax + barW / 2, this.y + barMaxH + 4, { align: 'center' });
    d.setFontSize(6);
    d.setTextColor(...AZUL_OSCURO);
    d.text(fmt(adoptado), ax + barW / 2, this.y + barMaxH - aBarH - 2, { align: 'center' });

    
    const promY = this.y + barMaxH - (promedio / maxVal) * barMaxH;
    d.setDrawColor(220, 80, 60);
    d.setLineWidth(0.4);
    d.setLineDashPattern([2, 1], 0);
    d.line(startX, promY, ax + barW, promY);
    d.setLineDashPattern([], 0);
    d.setFont('helvetica', 'normal');
    d.setFontSize(5);
    d.setTextColor(220, 80, 60);
    d.text(`prom: ${fmt(promedio)}`, ax + barW + 4, promY + 1.5);

    this.y += alto + 4;
  }

  private metodologia(v: ReturnType<PdfInforme['valores']>) {
    const d = this.doc;
    this.seccion('05', 'Metodología');

    this.parrafo(
      v.esAlquiler
        ? 'El valor locativo mensual se determinó mediante el método comparativo de mercado, comparando ofertas de alquiler de características similares en la zona.'
        : 'El valor de mercado se determinó mediante el método comparativo de mercado, uno de los métodos técnicos de mayor aceptación para la valuación de inmuebles urbanos.'
    );

    this.y += 2;

    const pasos = [
      'Datos del inmueble',
      'Comparables',
      'Normalización',
      'Ajustes',
      'Modelo de valoración',
      'Resultado',
    ];
    const pasoW = CONTENT_W / pasos.length;
    const pasoH = 14;
    this.asegurarEspacio(pasoH + 10);

    pasos.forEach((paso, i) => {
      const x = MARGEN + i * pasoW;
      const isLast = i === pasos.length - 1;

      
      d.setFillColor(...(isLast ? AZUL_SECUNDARIO : GRIS_CLARO));
      d.circle(x + pasoW / 2, this.y + 5, 4, 'F');
      d.setFont('helvetica', 'bold');
      d.setFontSize(7);
      d.setTextColor(...(isLast ? BLANCO : GRIS_OSCURO));
      d.text(String(i + 1), x + pasoW / 2, this.y + 6.5, { align: 'center' });

      
      d.setFont('helvetica', 'normal');
      d.setFontSize(6);
      d.setTextColor(...GRIS_OSCURO);
      const lines = d.splitTextToSize(paso, pasoW - 4);
      d.text(lines, x + pasoW / 2, this.y + 13, { align: 'center', lineHeightFactor: 1.2 });

      
      if (!isLast) {
        d.setDrawColor(...BORDE);
        d.setLineWidth(0.3);
        d.line(x + pasoW / 2 + 4.5, this.y + 5, x + pasoW / 2 + pasoW - 4.5, this.y + 5);
        
        d.setFillColor(...BORDE);
        d.triangle(
          x + pasoW / 2 + pasoW - 4.5, this.y + 3.5,
          x + pasoW / 2 + pasoW - 4.5, this.y + 6.5,
          x + pasoW / 2 + pasoW - 2.5, this.y + 5,
          'F'
        );
      }
    });
    this.y += pasoH + 6;

    this.parrafo('Procedimiento:', { bold: true, size: 8.5 });
    this.viñeta('Relevamiento de datos del inmueble declarados por el solicitante.');
    this.viñeta('Recolección y depuración de propiedades comparables de la zona.');
    this.viñeta('Homogeneización por superficie, estado y características particulares.');
    this.viñeta('Cálculo del valor por metro cuadrado y del valor resultante.');

    if (v.esIA) {
      this.viñeta(
        'El modelo de Machine Learning de Spatial Value (RandomForestRegressor) procesa las variables normalizadas y aplica ajustes automáticos para generar la estimación final.'
      );
    }

    this.y += 1;
    this.parrafo(
      `Moneda: los valores se expresan en dólares estadounidenses (USD). Equivalencia en pesos argentinos calculada al tipo de cambio de $${fmt(TIPO_CAMBIO)}/${TC_FUENTE} al ${TC_FECHA}. No incluye impuestos, gastos de escrituración ni comisiones.`,
      { size: 7.5, color: GRIS }
    );
    this.parrafo(
      'El resultado constituye una estimación preliminar, sujeta a inspección técnica en sitio y documentación legal del inmueble.',
      { size: 7.5, color: GRIS }
    );
  }

  private conclusion(v: ReturnType<PdfInforme['valores']>) {
    this.seccion('06', 'Conclusión');

    this.tarjetaValor(v);

    if (v.esAlquiler) {
      this.parrafo(
        `El valor locativo mensual estimado asciende a ${montoEnLetras(v.valorArs, 'ARS')} ($${fmt(v.valorArs)} ARS), equivalente a ${montoEnLetras(v.valorUsd, 'USD')} (${fmt(v.valorUsd)} USD).`
      );
    } else {
      this.parrafo(
        `El valor estimado asciende a ${montoEnLetras(v.valorUsd, 'USD')} (${fmt(v.valorUsd)} USD), equivalente a aproximadamente ${fmt(v.valorArs)} pesos argentinos.`
      );
    }

    this.parrafo(
      'Se concluye que el inmueble presenta un valor de mercado razonable y consistente con los comparables relevados, considerando su tipología, superficies, estado y ubicación.'
    );

    this.parrafo(
      'El valor corresponde a la fecha de emisión y puede variar según la evolución del mercado, el tipo de cambio y la inspección técnica.',
      { size: 7.5, color: GRIS }
    );
  }

  private limitaciones() {
    this.seccion('07', 'Limitaciones');

    this.parrafo(
      'Este informe se emite en base a datos provistos por el solicitante e información pública de mercado. No constituye una tasación certificada por un profesional matriculado.'
    );
    this.viñeta('No constituye inspección técnica en sitio.');
    this.viñeta('No certifica la situación dominial del inmueble.');
    this.viñeta('No debe utilizarse como único sustento para operaciones financieras, judiciales o fiscales.');
    this.viñeta('Los valores son estimaciones preliminares sujetas a verificación.');

    this.y += 2;

    
    const d = this.doc;
    const firmaY = this.y;
    d.setDrawColor(...BORDE);
    d.setLineWidth(0.3);
    d.setLineDashPattern([2, 2], 0);
    d.rect(MARGEN, firmaY, CONTENT_W, 22, 'S');
    d.setLineDashPattern([], 0);

    d.setFont('helvetica', 'normal');
    d.setFontSize(7);
    d.setTextColor(...GRIS);
    d.text('Documento generado digitalmente por', MARGEN + 6, firmaY + 7);
    d.setFont('helvetica', 'bold');
    d.setFontSize(9);
    d.setTextColor(...AZUL_OSCURO);
    d.text('Spatial Value', MARGEN + 6, firmaY + 13);
    d.setFont('helvetica', 'normal');
    d.setFontSize(7);
    d.setTextColor(...GRIS);
    d.text(`Buenos Aires, ${this.fechaLarga}`, W - MARGEN - 6, firmaY + 7, { align: 'right' });
    d.text('Verifique con N° de informe en spatialvalue.vercel.app', W - MARGEN - 6, firmaY + 13, { align: 'right' });

    
    const sealCx = MARGEN + CONTENT_W / 2;
    const sealCy = firmaY + 11;
    d.setDrawColor(...AZUL_SECUNDARIO);
    d.setLineWidth(0.4);
    d.circle(sealCx, sealCy, 6, 'S');
    d.setFillColor(...AZUL_SECUNDARIO);
    d.circle(sealCx, sealCy, 5, 'F');
    d.setFont('helvetica', 'bold');
    d.setFontSize(7);
    d.setTextColor(...BLANCO);
    d.text('SV', sealCx, sealCy + 1, { align: 'center' });

    this.y = firmaY + 28;
  }

  private anexos() {
    this.seccion('08', 'Anexos');
    this.parrafo('Los siguientes anexos complementan este informe y se incorporarán cuando el cliente los proporcione.');

    const anexos = [
      ['A', 'Fotografías de la propiedad', 'Registro fotográfico de ambientes y estado de conservación.'],
      ['B', 'Plano de la propiedad', 'Plano de arquitectura y distribución de superficies.'],
      ['C', 'Documentación legal', 'Escritura, certificado catastral osimilar.'],
    ];

    anexos.forEach(([codigo, titulo, desc]) => {
      const d = this.doc;
      const alto = 16;
      this.asegurarEspacio(alto + 2);
      const y0 = this.y;

      d.setDrawColor(...BORDE);
      d.setLineWidth(0.3);
      d.setLineDashPattern([2, 2], 0);
      d.rect(MARGEN, y0, CONTENT_W, alto, 'S');
      d.setLineDashPattern([], 0);

      
      d.setFillColor(...GRIS_CLARO);
      d.roundedRect(MARGEN, y0, 28, alto, 2, 2, 'F');
      d.setFont('helvetica', 'bold');
      d.setFontSize(9);
      d.setTextColor(...AZUL_OSCURO);
      d.text(codigo, MARGEN + 14, y0 + 6, { align: 'center' });

      
      d.setFont('helvetica', 'bold');
      d.setFontSize(8);
      d.setTextColor(...NEGRO);
      d.text(titulo, MARGEN + 34, y0 + 6);
      d.setFont('helvetica', 'normal');
      d.setFontSize(7);
      d.setTextColor(...GRIS);
      d.text(desc, MARGEN + 34, y0 + 12);

      this.y = y0 + alto + 2;
    });
  }

  private tablaMinimalista(headers: string[], rows: (string | number)[][]) {
    const d = this.doc;
    const colW = headers.length === 2 ? [70, CONTENT_W - 70] : [CONTENT_W / headers.length];
    const pad = 3;

    rows.forEach((row, ri) => {
      const alto = 10;
      this.asegurarEspacio(alto);
      d.setFillColor(...(ri % 2 === 0 ? BLANCO : GRIS_CLARO));
      d.rect(MARGEN, this.y, CONTENT_W, alto, 'F');

      d.setFont('helvetica', 'normal');
      d.setFontSize(7.5);
      d.setTextColor(...GRIS);
      d.text(String(row[0]), MARGEN + pad, this.y + 6);

      d.setFont('helvetica', 'bold');
      d.setFontSize(8);
      d.setTextColor(...NEGRO);
      d.text(String(row[1]), MARGEN + colW[0] + pad, this.y + 6);

      
      d.setDrawColor(...BORDE);
      d.setLineWidth(0.15);
      d.line(MARGEN, this.y + alto, MARGEN + CONTENT_W, this.y + alto);

      this.y += alto;
    });
  }

  private nombreArchivo(): string {
    const esLoc = esAlquiler(this.data);
    const dir = String(this.data.direccion || 'inmueble')
      .replace(/[^\w\d]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return `${esLoc ? 'Valoracion-Locativa' : 'Valoracion'}-${dir}.pdf`;
  }

  async generar(): Promise<void> {
    const d = this.doc;
    const v = this.valores();

    this.portada(v);
    d.addPage();
    this.encabezadoInterior();
    this.y = 38;

    this.resumen(v);
    this.propiedad(v);
    this.entorno(v);
    this.mercado(v);
    this.metodologia(v);
    this.conclusion(v);
    this.limitaciones();
    this.anexos();

    
    const total = d.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      d.setPage(i);
      if (i === 1) {
        
      } else {
        this.pie(i, total);
      }
    }

    if (this.guardarHook) this.guardarHook(d, this.nombreArchivo());
    else d.save(this.nombreArchivo());
  }
}

export async function generarInformePdf(
  data: DatosInforme,
  clienteNombre?: string,
  opciones: OpcionesInforme = {}
): Promise<void> {
  const logo = await convertirLogoAPng();
  const informe = new PdfInforme(data, clienteNombre ?? '—', logo, opciones.guardar ?? null);
  await informe.generar();
}
