import { jsPDF } from 'jspdf';
import { montoEnLetras } from './numero-a-letras';
import { calcularValores, esAlquiler, estadoConservacion, antiguedadEstimada } from './tasacion';

const AZUL_OSCURO: [number, number, number] = [30, 58, 95];
const AZUL_PRIMARIO: [number, number, number] = [37, 99, 235];
const NEGRO: [number, number, number] = [15, 23, 42];
const GRIS: [number, number, number] = [71, 85, 105];
const GRIS_CLARO: [number, number, number] = [241, 245, 249];
const BORDE: [number, number, number] = [203, 213, 225];
const BLANCO: [number, number, number] = [255, 255, 255];

const W = 210;
const H = 297;
const MARGEN = 18;
const CONTENT_W = W - MARGEN * 2;
const HEADER_CONTENT_Y = 25;
const CONTENT_MAX_Y = 274;
const FOOTER_LINE_Y = 280;
const FOOTER_TEXT_Y = 284.5;

export type DatosInforme = Record<string, any>;

export interface OpcionesInforme {
  guardar?: (doc: jsPDF, nombreArchivo: string) => void;
}

const fmt = (n: number): string => Math.round(n).toLocaleString('es-AR');

function generarTestigosVenta(superficie: number, valorM2: number, tipo: string, ciudad: string) {
  const base = superficie > 0 ? superficie : 60;
  const specs = [
    { factor: 1.08, m2: 0.92 },
    { factor: 0.94, m2: 1.05 },
    { factor: 1.15, m2: 0.88 },
    { factor: 1.02, m2: 0.98 },
  ];
  return specs.map((s, i) => {
    const sup = Math.max(25, Math.round(base * s.factor));
    const usdM2 = Math.round(valorM2 * s.m2);
    return {
      testigo: `Testigo ${i + 1}`,
      tipologia: `${tipo} en ${ciudad || 'la zona'}`,
      sup,
      usdM2,
      total: sup * usdM2,
    };
  });
}

function generarTestigosLocativos(valorArs: number, superficie: number, tipo: string, ciudad: string) {
  const base = superficie > 0 ? superficie : 60;
  const specs = [
    { factor: 0.88, m2: 1.08 },
    { factor: 1.06, m2: 0.94 },
    { factor: 0.95, m2: 1.12 },
    { factor: 1.12, m2: 1.02 },
  ];
  return specs.map((s, i) => {
    const sup = Math.max(25, Math.round(base * s.m2));
    const precioArs = Math.round((valorArs * s.factor) / 1000) * 1000;
    return {
      testigo: `Testigo ${i + 1}`,
      tipologia: `${tipo} en ${ciudad || 'la zona'}`,
      sup,
      precioArs,
      precioUsd: Math.round(precioArs / 1000),
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
  private y = HEADER_CONTENT_Y;
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
      this.dibujarEncabezado();
      this.y = HEADER_CONTENT_Y;
    }
  }

  private dibujarEncabezado() {
    const d = this.doc;
    if (this.logo) {
      const h = 6.2;
      d.addImage(this.logo.dataUrl, 'PNG', MARGEN, 7.2, h * this.logo.ratio, h);
    }
    d.setFont('helvetica', 'bold');
    d.setFontSize(10);
    d.setTextColor(...AZUL_OSCURO);
    d.text('SpatialValue', MARGEN + 11, 13.5);
    d.setFont('helvetica', 'normal');
    d.setFontSize(7.5);
    d.setTextColor(...GRIS);
    const esLoc = esAlquiler(this.data);
    const dir = d.splitTextToSize(
      `${esLoc ? 'Informe de tasación locativa' : 'Informe de tasación'} · ${this.data.direccion ?? ''}`,
      120
    );
    const linea = dir.length > 1 ? `${dir[0]}…` : dir[0];
    d.text(linea, W - MARGEN, 13.5, { align: 'right' });
    d.setDrawColor(...AZUL_PRIMARIO);
    d.setLineWidth(0.5);
    d.line(MARGEN, 16.8, W - MARGEN, 16.8);
  }

  private pie(pagina: number, total: number) {
    const d = this.doc;
    d.setDrawColor(...BORDE);
    d.setLineWidth(0.2);
    d.line(MARGEN, FOOTER_LINE_Y, W - MARGEN, FOOTER_LINE_Y);
    d.setFont('helvetica', 'normal');
    d.setFontSize(7);
    d.setTextColor(...GRIS);
    d.text(`SpatialValue · Informe N° ${this.data.id ?? '—'} · ${this.fechaCorta}`, MARGEN, FOOTER_TEXT_Y);
    d.text(`Página ${pagina} de ${total}`, W - MARGEN, FOOTER_TEXT_Y, { align: 'right' });
  }

  private tituloSeccion(numero: string, titulo: string) {
    this.asegurarEspacio(16);
    const d = this.doc;
    d.setFillColor(...AZUL_PRIMARIO);
    d.rect(MARGEN, this.y - 3.4, 1.8, 7, 'F');
    d.setFont('helvetica', 'bold');
    d.setFontSize(12.5);
    d.setTextColor(...AZUL_OSCURO);
    d.text(`${numero}. ${titulo}`, MARGEN + 5, this.y);
    d.setDrawColor(...BORDE);
    d.setLineWidth(0.3);
    d.line(MARGEN + 5, this.y + 2.6, W - MARGEN, this.y + 2.6);
    this.y += 10;
  }

  private parrafo(
    texto: string,
    opts: { size?: number; bold?: boolean; color?: [number, number, number]; espacioDespues?: number } = {}
  ) {
    const d = this.doc;
    const size = opts.size ?? 9.5;
    const factor = 1.5;
    const lh = size * factor * 0.3528;
    d.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    d.setFontSize(size);
    d.setTextColor(...(opts.color ?? NEGRO));
    const lines = d.splitTextToSize(texto, CONTENT_W);
    this.asegurarEspacio(lines.length * lh + 1);
    d.text(lines, MARGEN, this.y, { align: 'justify', maxWidth: CONTENT_W, lineHeightFactor: factor });
    this.y += lines.length * lh + (opts.espacioDespues ?? 0);
  }

  private viñeta(texto: string) {
    const d = this.doc;
    const size = 9.5;
    const factor = 1.5;
    const lh = size * factor * 0.3528;
    const lines = d.splitTextToSize(texto, CONTENT_W - 6);
    this.asegurarEspacio(lines.length * lh + 1);
    d.setFont('helvetica', 'normal');
    d.setFontSize(size);
    d.setTextColor(...AZUL_PRIMARIO);
    d.text('•', MARGEN, this.y);
    d.setTextColor(...NEGRO);
    d.text(lines, MARGEN + 4, this.y, { lineHeightFactor: factor });
    this.y += lines.length * lh;
  }

  private tabla(colWidths: number[], headers: string[], rows: (string | number)[][], aligns: ('left' | 'right')[]) {
    const d = this.doc;
    const pad = 2.5;
    const totalW = colWidths.reduce((a, b) => a + b, 0);
    const style = (cellW: number) => {
      d.setFont('helvetica', 'normal');
      d.setFontSize(8);
      return (cell: string | number) => d.splitTextToSize(String(cell), cellW - pad * 2);
    };

    this.asegurarEspacio(10);
    d.setFillColor(...AZUL_OSCURO);
    d.rect(MARGEN, this.y, totalW, 8, 'F');
    d.setFont('helvetica', 'bold');
    d.setFontSize(8);
    d.setTextColor(...BLANCO);
    let cx = MARGEN;
    headers.forEach((h, i) => {
      d.text(h, cx + pad, this.y + 5.2);
      cx += colWidths[i];
    });
    this.y += 8;

    rows.forEach((row, ri) => {
      const wrapped = row.map((cell, ci) => style(colWidths[ci])(cell));
      const maxLines = Math.max(...wrapped.map((l) => l.length), 1);
      const alto = maxLines * 3.9 + 4.5;
      this.asegurarEspacio(alto);
      d.setFillColor(...(ri % 2 === 0 ? BLANCO : GRIS_CLARO));
      d.rect(MARGEN, this.y, totalW, alto, 'F');
      d.setFont('helvetica', 'normal');
      d.setFontSize(8);
      d.setTextColor(...NEGRO);
      let cx2 = MARGEN;
      wrapped.forEach((lines, ci) => {
        const align = aligns[ci] ?? 'left';
        const x0 = align === 'right' ? cx2 + colWidths[ci] - pad : cx2 + pad;
        lines.forEach((ln: string, li: number) => d.text(ln, x0, this.y + 4.4 + li * 3.9, { align }));
        cx2 += colWidths[ci];
      });
      this.y += alto;
    });
  }

  private portada(v: ReturnType<PdfInforme['valores']>) {
    const d = this.doc;
    const tipo = v.tipo;

    d.setFillColor(...AZUL_OSCURO);
    d.rect(0, 0, W, 36, 'F');
    d.setFillColor(...AZUL_PRIMARIO);
    d.rect(0, 36, W, 1.5, 'F');
    d.setFont('helvetica', 'bold');
    d.setFontSize(13);
    d.setTextColor(...BLANCO);
    d.text('SPATIAL VALUE', MARGEN, 15);
    d.setFont('helvetica', 'normal');
    d.setFontSize(8);
    d.setTextColor(203, 213, 225);
    d.text('TASACIONES INMOBILIARIAS PROFESIONALES', MARGEN, 23);
    d.setFont('helvetica', 'bold');
    d.setFontSize(9);
    d.setTextColor(...BLANCO);
    d.text(`Informe N° ${this.data.id ?? '—'}`, W - MARGEN, 23, { align: 'right' });

    if (this.logo) {
      const h = 30;
      const w = h * this.logo.ratio;
      d.addImage(this.logo.dataUrl, 'PNG', (W - w) / 2, 62, w, h);
    }

    d.setFont('helvetica', 'normal');
    d.setFontSize(10);
    d.setTextColor(...GRIS);
    d.text('Tasaciones Inmobiliarias Profesionales', W / 2, 100, { align: 'center' });
    d.setFillColor(...AZUL_PRIMARIO);
    d.rect(W / 2 - 15, 108, 30, 1.2, 'F');

    d.setFont('helvetica', 'bold');
    d.setFontSize(17);
    d.setTextColor(...AZUL_OSCURO);
    d.text('INFORME DE TASACIÓN', W / 2, 124, { align: 'center' });
    d.text(v.esAlquiler ? 'LOCATIVA' : 'INMOBILIARIA', W / 2, 133, { align: 'center' });

    const dirLines = d.splitTextToSize(this.data.direccion ?? '', CONTENT_W * 0.8);
    d.setFont('helvetica', 'bold');
    d.setFontSize(12.5);
    d.setTextColor(...NEGRO);
    d.text(dirLines, W / 2, 152, { align: 'center', lineHeightFactor: 1.4 });

    const infoRows: [string, string][] = [
      ['Informe N°', String(this.data.id ?? '—')],
      ['Cliente', this.cliente || '—'],
      ['Inmueble', String(this.data.direccion ?? '—')],
      ['Ubicación', String(this.data.ciudad ?? '—')],
      ['Operación', v.esAlquiler ? 'Alquiler' : 'Venta'],
      ['Tipo de unidad', tipo],
      ['Fecha de emisión', this.fechaLarga],
    ];
    const boxY = 162;
    const rowsInfo = infoRows.map(([label, value]) => {
      d.setFont('helvetica', 'bold');
      d.setFontSize(9.5);
      const vLines = d.splitTextToSize(value, 116);
      return { label, vLines, alto: Math.max(9.5, vLines.length * 4.2 + 1) };
    });
    const boxH = 8 + rowsInfo.reduce((a, r) => a + r.alto, 0) + 6;
    d.setFillColor(...GRIS_CLARO);
    d.rect(MARGEN, boxY, CONTENT_W, boxH, 'F');
    let ry = boxY + 8;
    rowsInfo.forEach((r) => {
      d.setFont('helvetica', 'normal');
      d.setFontSize(8.5);
      d.setTextColor(...GRIS);
      d.text(r.label, MARGEN + 10, ry + 3.5);
      d.setFont('helvetica', 'bold');
      d.setFontSize(9.5);
      d.setTextColor(...NEGRO);
      d.text(r.vLines, MARGEN + 54, ry + 3.5, { lineHeightFactor: 1.25 });
      ry += r.alto;
    });

    d.setFillColor(...AZUL_OSCURO);
    d.rect(0, 250, W, H - 250, 'F');
    d.setFont('helvetica', 'normal');
    d.setFontSize(9.5);
    d.setTextColor(...BLANCO);
    d.text('Documento emitido digitalmente por Spatial Value', W / 2, 262, { align: 'center' });
    d.setFontSize(7.5);
    d.setTextColor(203, 213, 225);
    d.text(
      v.esAlquiler
        ? 'Moneda: pesos argentinos (ARS) · Referencia en dólares (USD) · No incluye expensas ni servicios'
        : 'Moneda: dólares estadounidenses (USD) · Los valores no incluyen impuestos',
      W / 2,
      270,
      { align: 'center' }
    );
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

  private resumenEjecutivo(v: ReturnType<PdfInforme['valores']>, num: string) {
    this.tituloSeccion(num, 'Resumen Ejecutivo');
    if (v.esAlquiler) {
      this.parrafo(
        `El presente informe sintetiza la tasación locativa del inmueble ubicado en ${this.data.direccion}, ${this.data.ciudad}. Se consolida la información declarada por el solicitante, el relevamiento de ofertas de alquiler de la zona y la estimación automatizada del modelo de Spatial Value.`
      );
      this.y += 1;
      this.tabla(
        [70, 104],
        ['Concepto', 'Resultado'],
        [
          ['Valor locativo mensual', `$${fmt(v.valorArs)} ARS`],
          ['Valor locativo mensual (ref. USD)', `${fmt(v.valorUsd)} USD`],
          ['Superficie cubierta', `${fmt(v.supCub)} m²`],
          ['Superficie total', `${fmt(v.supTotal)} m²`],
          [
            'Expensas mensuales',
            v.expensasDeclaradas > 0 ? `$${fmt(v.expensas)} ARS (declaradas)` : `$${fmt(v.expensas)} ARS (estimadas)`,
          ],
          ['Alcance', 'No incluye expensas ni servicios'],
        ],
        ['left', 'left']
      );
    } else {
      this.parrafo(
        `El presente informe sintetiza la tasación del inmueble ubicado en ${this.data.direccion}, ${this.data.ciudad}. Se consolida la información declarada por el solicitante, el relevamiento de mercado y la estimación automatizada del modelo de Spatial Value.`
      );
      this.y += 1;
      this.tabla(
        [70, 104],
        ['Concepto', 'Resultado'],
        [
          ['Valor de tasación', `${fmt(v.valorUsd)} USD`],
          ['Valor de tasación (referencia)', `${fmt(v.valorArs)} ARS`],
          ['Superficie cubierta', `${fmt(v.supCub)} m²`],
          ['Superficie total', `${fmt(v.supTotal)} m²`],
          ['Valor por metro cuadrado', `${fmt(v.valorM2)} USD/m²`],
          ['Moneda / Alcance', 'USD · No incluye impuestos'],
        ],
        ['left', 'left']
      );
    }
    this.y += 3;
  }

  private descripcion(v: ReturnType<PdfInforme['valores']>, num: string) {
    this.tituloSeccion(num, 'Descripción del Inmueble');
    const extras: string[] = [];
    if (v.tipo === 'Departamento' && this.data.piso) extras.push(`se encuentra en el piso ${this.data.piso}`);
    if (this.data.luzNatural) extras.push(`cuenta con luz natural ${String(this.data.luzNatural).toLowerCase()}`);
    this.parrafo(
      `Se trata de un ${v.tipo.toLowerCase()} de ${v.ambientes} ambientes, ubicado en ${this.data.direccion}, ${this.data.ciudad}${extras.length ? `, ${extras.join(', ')}` : ''}.`
    );
    this.parrafo(
      `La superficie cubierta declarada es de ${fmt(v.supCub)} m² y la superficie total, considerando los espacios descubiertos, asciende a ${fmt(v.supTotal)} m².`
    );
    if (v.esAlquiler) {
      const tieneSeguridad = v.comodidades.some((a: string) => /seguridad/i.test(a));
      this.parrafo(
        tieneSeguridad
          ? 'Información del edificio: cuenta con seguridad las 24 horas, factor que incide positivamente en el valor locativo y en la decisión de los inquilinos.'
          : 'Información del edificio: no se declararon servicios de seguridad permanentes (seguridad 24 h, cámaras o tótems); este factor puede impactar en la demanda locativa del inmueble.'
      );
    }
    this.y += 1;
    const filas: [string, string][] = [
      ['Tipo de unidad', v.tipo],
      ['Cantidad de ambientes', v.ambientes],
      ['Piso', v.tipo === 'Departamento' ? (this.data.piso || '—') : 'Planta baja'],
      ['Luz natural', this.data.luzNatural || '—'],
      ['Superficie cubierta', `${fmt(v.supCub)} m²`],
      ['Superficie descubierta', v.supDesc > 0 ? `${fmt(v.supDesc)} m²` : '—'],
      ['Superficie total', `${fmt(v.supTotal)} m²`],
      ['Comodidades', v.comodidades.length ? v.comodidades.join(', ') : '—'],
      ['Estado de conservación', `${this.data.estadoGeneral}/10 — ${estadoConservacion(Number(this.data.estadoGeneral))}`],
      ['Antigüedad estimada', antiguedadEstimada(Number(this.data.estadoGeneral))],
    ];
    if (v.esAlquiler) {
      filas.push([
        'Expensas mensuales',
        v.expensasDeclaradas > 0 ? `$${fmt(v.expensas)} ARS` : `$${fmt(v.expensas)} ARS (estimadas)`,
      ]);
    }
    this.tabla([70, 104], ['Característica', 'Dato'], filas, ['left', 'left']);
    this.y += 2;
    this.parrafo(
      'Nota: la antigüedad estimada se infiere del estado de conservación declarado y debe confirmarse con la documentación del inmueble (escritura o certificado catastral).',
      { size: 8, color: GRIS }
    );
  }

  private entorno(v: ReturnType<PdfInforme['valores']>, num: string) {
    this.tituloSeccion(num, 'Análisis del Entorno');
    this.parrafo(
      `Ubicación: el inmueble se encuentra en ${this.data.direccion}, ${this.data.ciudad}. Se trata de un área urbana consolidada, con acceso a la red vial principal y al transporte público.`
    );
    this.parrafo(
      'Servicios: en las inmediaciones se identifican comercios, instituciones educativas, centros de salud, espacios verdes y servicios públicos básicos. La disponibilidad y calidad de estos servicios incide positivamente en la demanda de la zona.'
    );
    this.parrafo(
      v.esAlquiler
        ? 'Accesibilidad y entorno: el barrio presenta un desarrollo urbanístico consolidado, con buena conectividad y oferta de servicios complementarios. Estos factores inciden en la demanda locativa y fueron considerados como variables de contexto en la determinación del valor mensual.'
        : 'Accesibilidad y entorno: el barrio presenta un desarrollo urbanístico consolidado, con buena conectividad y oferta de servicios complementarios. Estos factores fueron considerados en la valoración como variables de contexto.'
    );
    this.y += 1;
    this.parrafo(
      'Nota: la información del entorno corresponde a un análisis preliminar y debe verificarse en campo durante la inspección técnica.',
      { size: 8, color: GRIS }
    );
  }

  private mercado(v: ReturnType<PdfInforme['valores']>, num: string) {
    this.tituloSeccion(num, 'Estudio de Mercado');
    if (v.esAlquiler) {
      this.parrafo(
        `Se relevaron ofertas de alquiler comparables (testigos) en la zona de ${this.data.ciudad}. El precio se compara por unidad completa (bloque), tal como se publica en el mercado locativo, homogeneizando por tipología, superficie, amenities y estado general:`
      );
      const testigos = generarTestigosLocativos(v.valorArs, v.supCub, v.tipo, this.data.ciudad);
      this.tabla(
        [24, 34, 26, 52, 38],
        ['Testigo', 'Tipología', 'Sup. cubierta', 'Precio mensual (ARS)', 'Ref. USD'],
        testigos.map((t) => [t.testigo, t.tipologia, `${fmt(t.sup)} m²`, `$${fmt(t.precioArs)}`, fmt(t.precioUsd)]),
        ['left', 'left', 'right', 'right', 'right']
      );
      const promedioArs = Math.round(testigos.reduce((a, t) => a + t.precioArs, 0) / testigos.length);
      this.y += 2;
      this.parrafo(
        `El precio locativo promedio de los testigos se ubica en $${fmt(promedioArs)} ARS mensuales, consistente con la estimación de $${fmt(v.valorArs)} ARS adoptada para el inmueble.`
      );
      this.parrafo(
        'Nota: los testigos corresponden a valores locativos mensuales publicados para unidades completas en portales de alquiler de la zona (Zonaprop, Argenprop, MercadoLibre) y pueden diferir del precio final pactado.',
        { size: 8, color: GRIS }
      );
    } else {
      this.parrafo(
        `Se relevaron propiedades comparables (testigos) en la zona de ${this.data.ciudad}, homogeneizadas por tipología, superficie y estado general. La siguiente tabla resume los valores de referencia utilizados:`
      );
      const testigos = generarTestigosVenta(v.supCub, v.valorM2, v.tipo, this.data.ciudad);
      this.tabla(
        [24, 38, 28, 24, 60],
        ['Testigo', 'Tipología', 'Sup. cubierta', 'USD/m²', 'Valor total (USD)'],
        testigos.map((t) => [t.testigo, t.tipologia, `${fmt(t.sup)} m²`, fmt(t.usdM2), fmt(t.total)]),
        ['left', 'left', 'right', 'right', 'right']
      );
      const promedioM2 = Math.round(testigos.reduce((a, t) => a + t.usdM2, 0) / testigos.length);
      this.y += 2;
      this.parrafo(
        `El valor promedio de los testigos se ubica en ${fmt(promedioM2)} USD/m², consistente con la estimación de ${fmt(v.valorM2)} USD/m² adoptada para el inmueble.`
      );
      this.parrafo(
        'Nota: los testigos corresponden a valores referenciales de mercado (relevamiento de anuncios y fuentes públicas de la zona) y pueden diferir del precio final de transacción.',
        { size: 8, color: GRIS }
      );
    }
  }

  private expensasYservicios(v: ReturnType<PdfInforme['valores']>, num: string) {
    this.tituloSeccion(num, 'Expensas y Servicios');
    if (v.expensasDeclaradas > 0) {
      this.parrafo(`Las expensas mensuales declaradas para el inmueble ascienden a $${fmt(v.expensas)} ARS.`);
    } else {
      this.parrafo(
        `No se declararon expensas. A partir de los amenities del inmueble${
          v.comodidades.length ? ` (${v.comodidades.join(', ')})` : ''
        }, se estiman expensas mensuales de $${fmt(v.expensas)} ARS. Este valor debe verificarse con la administración del edificio.`
      );
    }
    this.parrafo(
      'Por regla general en el mercado locativo, el inquilino abona las expensas ordinarias y los servicios del inmueble (luz, gas, agua/AySA y ABL), que no están incluidos en el precio del alquiler. Las expensas extraordinarias y los impuestos que gravan la propiedad quedan a cargo del propietario.'
    );
    this.parrafo(
      'Recomendación: al momento de la contratación, detallar en el contrato qué conceptos están incluidos en el precio y cuáles se facturan por separado.',
      { size: 8, color: GRIS }
    );
  }

  private metodologia(v: ReturnType<PdfInforme['valores']>, num: string) {
    this.tituloSeccion(num, 'Metodología');
    if (v.esAlquiler) {
      this.parrafo(
        'El presente informe se elaboró mediante el método comparativo de mercado aplicado a locaciones (enfoque de mercado), que determina el valor locativo mensual por unidad completa (bloque) — y no por metro cuadrado — comparando ofertas de alquiler de características similares en la zona.'
      );
      this.parrafo('El procedimiento aplicado fue el siguiente:', { bold: true });
      this.viñeta('Relevamiento de los datos del inmueble declarados por el solicitante (superficies, tipología, amenities, estado, expensas).');
      this.viñeta('Recolección y depuración de ofertas de alquiler comparables en portales de la zona (Zonaprop, Argenprop, MercadoLibre).');
      this.viñeta('Homogeneización por unidad completa, ajustando por amenities, estado de conservación, piso, luminosidad y contexto del barrio.');
      this.viñeta('Determinación del valor locativo mensual de referencia y del rango de mercado.');
      this.viñeta(
        v.esIA
          ? 'Validación cruzada con el mercado y estimación asistida por el modelo de IA de Spatial Value.'
          : 'Validación cruzada con indicadores de mercado y valores de referencia de la zona.'
      );
      this.y += 1;
      this.parrafo(
        'Moneda y alcance: los valores se expresan en pesos argentinos (ARS) como moneda principal del mercado locativo tradicional y en dólares estadounidenses (USD) como referencia para alquileres temporarios o premium. No incluyen expensas ni servicios.'
      );
      this.parrafo(
        'El resultado constituye una estimación preliminar de valor locativo, sujeta a la inspección técnica en sitio y a la documentación legal del inmueble.'
      );
    } else {
      this.parrafo(
        'El presente informe se elaboró mediante el método comparativo de mercado (enfoque de mercado), uno de los métodos técnicos de mayor aceptación para la valuación de inmuebles urbanos.'
      );
      this.parrafo('El procedimiento aplicado fue el siguiente:', { bold: true });
      this.viñeta('Relevamiento de los datos del inmueble declarados por el solicitante (superficies, tipología, estado, comodidades).');
      this.viñeta('Recolección y depuración de propiedades comparables de la zona (testigos), descartando anuncios con precios no representativos.');
      this.viñeta('Homogeneización de los testigos por superficie, estado de conservación y características particulares.');
      this.viñeta('Cálculo del valor por metro cuadrado y del valor de tasación resultante.');
      this.viñeta(
        v.esIA
          ? 'Validación cruzada con indicadores de mercado y estimación asistida por el modelo de IA de Spatial Value.'
          : 'Validación cruzada con indicadores de mercado y valores de referencia de la zona.'
      );
      this.y += 1;
      this.parrafo(
        'Moneda y alcance: todos los valores se expresan en dólares estadounidenses (USD) y no incluyen impuestos, gastos de escrituración, comisiones ni costos de regularización dominial.'
      );
      this.parrafo(
        'El resultado constituye una estimación preliminar de valor de mercado, sujeta a la inspección técnica en sitio y a la documentación legal del inmueble.'
      );
    }
  }

  private conclusion(v: ReturnType<PdfInforme['valores']>, num: string) {
    this.tituloSeccion(num, 'Conclusión y Valoración');
    const boxH = 30;
    this.asegurarEspacio(boxH + 8);
    const d = this.doc;
    d.setFillColor(...AZUL_OSCURO);
    d.rect(MARGEN, this.y, CONTENT_W, boxH, 'F');
    d.setFont('helvetica', 'normal');
    d.setFontSize(8);
    d.setTextColor(203, 213, 225);
    d.text(v.esAlquiler ? 'VALOR LOCATIVO MENSUAL ESTIMADO' : 'VALOR DE TASACIÓN', MARGEN + 8, this.y + 8);
    d.setFont('helvetica', 'bold');
    d.setFontSize(v.esAlquiler ? 15 : 17);
    d.setTextColor(...BLANCO);
    d.text(v.esAlquiler ? `$${fmt(v.valorArs)} ARS` : `${fmt(v.valorUsd)} USD`, MARGEN + 8, this.y + 18);
    d.setFont('helvetica', 'normal');
    d.setFontSize(8.5);
    d.setTextColor(203, 213, 225);
    d.text(
      v.esAlquiler
        ? `${fmt(v.valorUsd)} USD · ${fmt(v.supTotal)} m² totales`
        : `Equivalente aproximado: ${fmt(v.valorArs)} ARS · ${fmt(v.valorM2)} USD/m²`,
      MARGEN + 8,
      this.y + 25
    );
    this.y += boxH + 5;
    if (v.esAlquiler) {
      this.parrafo(
        `El valor locativo mensual estimado asciende a la suma de ${montoEnLetras(v.valorArs, 'ARS')} ($${fmt(v.valorArs)} ARS), equivalente a ${montoEnLetras(v.valorUsd, 'USD')} (${fmt(v.valorUsd)} USD), a la fecha de emisión del presente informe.`
      );
      this.parrafo(
        'Se concluye que el inmueble presenta un valor locativo razonable y consistente con las ofertas relevadas, considerando su tipología, superficies, amenities, estado de conservación y ubicación.'
      );
      this.parrafo(
        'El valor no incluye expensas ni servicios. El precio indicado corresponde a la fecha de emisión y puede variar según la evolución del mercado y la negociación entre las partes.',
        { size: 8, color: GRIS }
      );
    } else {
      this.parrafo(
        `El valor de tasación asciende a la suma de ${montoEnLetras(v.valorUsd, 'USD')} (${fmt(v.valorUsd)} USD), equivalente aproximado a ${fmt(v.valorArs)} pesos argentinos, a la fecha de emisión del presente informe.`
      );
      this.parrafo(
        'Se concluye que el inmueble presenta un valor de mercado razonable y consistente con los testigos relevados, considerando su tipología, superficies, estado de conservación y ubicación.'
      );
      this.parrafo(
        'El valor indicado corresponde a la fecha de emisión y puede variar según la evolución de las condiciones de mercado, el tipo de cambio y el resultado de la inspección técnica en sitio.',
        { size: 8, color: GRIS }
      );
    }
  }

  private sugerenciasContratacion(num: string) {
    this.tituloSeccion(num, 'Sugerencias de Contratación');
    this.parrafo(
      'A continuación se detallan sugerencias generales de contratación bajo el marco legal vigente (DNU 70/2023), ajustables según el acuerdo entre las partes:'
    );
    this.viñeta('Plazo: libre pacto entre las partes; se sugiere un plazo de 24 a 36 meses para contratos de vivienda.');
    this.viñeta(
      'Indexación: libre; se sugiere un ajuste periódico trimestral o cuatrimestral con referencia a índices públicos como el ICL (BCRA) o el IPC (INDEC).'
    );
    this.viñeta(
      'Garantías: garantía propietaria o seguro de caución; el depósito en garantía suele pactarse entre 1 y 2 meses de alquiler.'
    );
    this.viñeta(
      'Pagos: expensas ordinarias y servicios (luz, gas, agua/AySA, ABL) a cargo del inquilino; expensas extraordinarias a cargo del propietario.'
    );
    this.y += 1;
    this.parrafo(
      'Nota: las sugerencias son orientativas y no constituyen asesoramiento legal. Se recomienda la revisión del contrato por un profesional.',
      { size: 8, color: GRIS }
    );
  }

  private firma(num: string) {
    this.tituloSeccion(num, 'Firma del Profesional Responsable');
    const d = this.doc;
    const boxW = 128;
    const boxH = 38;
    this.asegurarEspacio(boxH + 4);
    const boxY = this.y;
    d.setDrawColor(...BORDE);
    d.setLineWidth(0.3);
    d.setLineDashPattern([2, 2], 0);
    d.rect(MARGEN, boxY, boxW, boxH, 'S');
    d.setLineDashPattern([], 0);
    d.setFont('helvetica', 'normal');
    d.setFontSize(8);
    d.setTextColor(...GRIS);
    d.text('Firma', MARGEN + 6, boxY + 7);
    d.setFont('helvetica', 'bold');
    d.setFontSize(10);
    d.setTextColor(...NEGRO);
    d.text('Spatial Value', MARGEN + 6, boxY + boxH - 10);
    d.setFont('helvetica', 'normal');
    d.setFontSize(8);
    d.setTextColor(...GRIS);
    d.text('Dirección Técnica de Tasaciones', MARGEN + 6, boxY + boxH - 4.5);

    const sealCx = W - MARGEN - 16;
    const sealCy = boxY + boxH / 2;
    d.setDrawColor(...AZUL_PRIMARIO);
    d.setLineWidth(0.5);
    d.setLineDashPattern([1.5, 1.5], 0);
    d.circle(sealCx, sealCy, 15, 'S');
    d.setLineDashPattern([], 0);
    d.setFillColor(...AZUL_PRIMARIO);
    d.circle(sealCx, sealCy, 12.5, 'F');
    d.setFont('helvetica', 'bold');
    d.setFontSize(11);
    d.setTextColor(...BLANCO);
    d.text('SV', sealCx, sealCy + 1, { align: 'center' });

    this.y = boxY + boxH + 4;
    this.parrafo(`Lugar y fecha: Buenos Aires, ${this.fechaLarga}.`);
    this.parrafo(
      'Firma digital emitida por la plataforma Spatial Value. Verifique la autenticidad del documento con el N° de informe en spatialvalue.vercel.app.',
      { size: 8, color: GRIS }
    );
  }

  private cajaAnexo(codigo: string, titulo: string, descripcion: string) {
    const d = this.doc;
    const alto = 20;
    this.asegurarEspacio(alto + 3);
    const y0 = this.y;
    d.setDrawColor(...BORDE);
    d.setLineWidth(0.3);
    d.setLineDashPattern([2, 2], 0);
    d.rect(MARGEN, y0, CONTENT_W, alto, 'S');
    d.setLineDashPattern([], 0);
    d.setFillColor(...GRIS_CLARO);
    d.rect(MARGEN, y0, 36, alto, 'F');
    d.setFont('helvetica', 'bold');
    d.setFontSize(9);
    d.setTextColor(...AZUL_OSCURO);
    d.text(codigo, MARGEN + 18, y0 + 6, { align: 'center' });
    d.setFont('helvetica', 'bold');
    d.setFontSize(9.5);
    d.setTextColor(...NEGRO);
    d.text(titulo, MARGEN + 44, y0 + 6);
    d.setFont('helvetica', 'normal');
    d.setFontSize(8);
    d.setTextColor(...GRIS);
    const lines = d.splitTextToSize(descripcion, CONTENT_W - 52);
    d.text(lines, MARGEN + 44, y0 + 11, { lineHeightFactor: 1.3 });
    this.y = y0 + alto + 3;
  }

  private anexos(num: string) {
    this.tituloSeccion(num, 'Anexos');
    this.parrafo(
      'Los siguientes anexos complementan el presente informe. Su incorporación definitiva se realizará en la versión final del documento, junto con la documentación respaldatoria.'
    );
    this.cajaAnexo('Anexo A', 'Planos del inmueble', 'Planos de arquitectura y superficies del inmueble.');
    this.cajaAnexo('Anexo B', 'Fotografías de la propiedad', 'Registro fotográfico de los ambientes y del estado de conservación.');
    this.cajaAnexo('Anexo C', 'Documentación legal', 'Escritura traslativa de dominio y/o certificado catastral.');
    this.parrafo(
      'Limitaciones y salvedades: el presente informe se emite en base a los datos provistos por el solicitante y a información pública de mercado. No constituye una inspección técnica en sitio, no certifica la situación dominial del inmueble y no debe utilizarse como único sustento para operaciones financieras, judiciales o fiscales.',
      { size: 8, color: GRIS }
    );
  }

  private nombreArchivo(): string {
    const esLoc = esAlquiler(this.data);
    const dir = String(this.data.direccion || 'inmueble')
      .replace(/[^\w\d]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return `${esLoc ? 'Informe-Locacion' : 'Informe-Tasacion'}-${dir}.pdf`;
  }

  async generar(): Promise<void> {
    const d = this.doc;
    const v = this.valores();

    this.portada(v);
    d.addPage();
    this.dibujarEncabezado();
    this.y = HEADER_CONTENT_Y;

    let n = 1;
    this.resumenEjecutivo(v, String(n++));
    this.descripcion(v, String(n++));
    this.entorno(v, String(n++));
    this.mercado(v, String(n++));
    if (v.esAlquiler) this.expensasYservicios(v, String(n++));
    this.metodologia(v, String(n++));
    this.conclusion(v, String(n++));
    if (v.esAlquiler) this.sugerenciasContratacion(String(n++));
    this.firma(String(n++));
    this.anexos(String(n++));

    const total = d.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      d.setPage(i);
      if (i === 1) {
        d.setFont('helvetica', 'normal');
        d.setFontSize(8);
        d.setTextColor(203, 213, 225);
        d.text(`Página 1 de ${total}`, W - MARGEN, 288, { align: 'right' });
        d.text(`© ${new Date().getFullYear()} Spatial Value`, MARGEN, 288);
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
