import { TASA_ARS_USD } from './mercado';

export type Moneda = 'USD' | 'ARS';

export interface ConfigUsuario {
  telefono: string;
  avatar: string;
  instagram: string;
  twitter: string;
  linkedin: string;
  facebook: string;
  sitio_web: string;
  instagram_publico: boolean;
  twitter_publico: boolean;
  linkedin_publico: boolean;
  facebook_publico: boolean;
  sitio_publico: boolean;
  perfil_publico: boolean;
  mostrar_contacto: boolean;
  visibilidad_estadisticas: boolean;
  moneda: Moneda;
}

export const CONFIG_VACIO: ConfigUsuario = {
  telefono: '',
  avatar: '',
  instagram: '',
  twitter: '',
  linkedin: '',
  facebook: '',
  sitio_web: '',
  instagram_publico: true,
  twitter_publico: true,
  linkedin_publico: true,
  facebook_publico: true,
  sitio_publico: true,
  perfil_publico: true,
  mostrar_contacto: true,
  visibilidad_estadisticas: true,
  moneda: 'USD',
};

export function esConfigUsuario(v: unknown): v is ConfigUsuario {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.telefono === 'string' &&
    typeof c.avatar === 'string' &&
    typeof c.instagram === 'string' &&
    typeof c.twitter === 'string' &&
    typeof c.linkedin === 'string' &&
    typeof c.facebook === 'string' &&
    typeof c.sitio_web === 'string' &&
    typeof c.instagram_publico === 'boolean' &&
    typeof c.twitter_publico === 'boolean' &&
    typeof c.linkedin_publico === 'boolean' &&
    typeof c.facebook_publico === 'boolean' &&
    typeof c.sitio_publico === 'boolean' &&
    typeof c.perfil_publico === 'boolean' &&
    typeof c.mostrar_contacto === 'boolean' &&
    typeof c.visibilidad_estadisticas === 'boolean' &&
    (c.moneda === 'USD' || c.moneda === 'ARS')
  );
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validarTelefono(tel: string): boolean {
  const v = tel.trim();
  if (!v) return true;
  return /^\+?[0-9\s()-]{7,20}$/.test(v);
}

export function limpiarInstagram(v: string): string {
  const m = v.trim().match(/(?:instagram\.com\/)?@?([A-Za-z0-9._]{1,30})\/?$/);
  return m ? m[1] : '';
}

export function limpiarTwitter(v: string): string {
  const m = v.trim().match(/(?:twitter\.com\/|x\.com\/)?@?([A-Za-z0-9_]{1,15})\/?$/);
  return m ? m[1] : '';
}

export function instagramUrl(handle: string): string {
  return handle ? `https://instagram.com/${handle}` : '';
}

export function twitterUrl(handle: string): string {
  return handle ? `https://x.com/${handle}` : '';
}

export function limpiarLinkedin(v: string): string {
  const m = v.trim().match(/(?:linkedin\.com\/(?:in|company)\/)?([A-Za-z0-9][A-Za-z0-9\-_%.]{1,100})\/?$/);
  return m ? m[1] : '';
}

export function limpiarFacebook(v: string): string {
  const m = v.trim().match(/(?:facebook\.com\/)?([A-Za-z0-9.]{5,50})\/?$/);
  return m ? m[1] : '';
}

export function linkedinUrl(handle: string): string {
  return handle ? `https://linkedin.com/in/${handle}` : '';
}

export function facebookUrl(handle: string): string {
  return handle ? `https://facebook.com/${handle}` : '';
}

export function normalizarSitioWeb(v: string): string {
  const s = v.trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

export function esSitioWebValido(v: string): boolean {
  if (!v.trim()) return true;
  try {
    const url = new URL(normalizarSitioWeb(v));
    return url.hostname.includes('.');
  } catch {
    return false;
  }
}

export interface ReglasPassword {
  minLargo: boolean;
  mayuscula: boolean;
  numero: boolean;
  especial: boolean;
}

export function reglasPassword(pwd: string): ReglasPassword {
  return {
    minLargo: pwd.length >= 8,
    mayuscula: /[A-Z]/.test(pwd),
    numero: /[0-9]/.test(pwd),
    especial: /[^A-Za-z0-9]/.test(pwd),
  };
}

export function passwordValida(pwd: string): boolean {
  const r = reglasPassword(pwd);
  return r.minLargo && r.mayuscula && r.numero && r.especial;
}

export function formatValor(usd: number, moneda: Moneda): string {
  if (moneda === 'ARS') {
    return `$${Math.round(usd * TASA_ARS_USD).toLocaleString('es-AR')} ARS`;
  }
  return `$${Math.round(usd).toLocaleString('es-AR')} USD`;
}

export const AVATAR_MAX_BYTES = 300_000;

export function fileAAvatarBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('El archivo no es una imagen.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('La imagen es inválida.'));
      img.onload = () => {
        const LADO = 256;
        const canvas = document.createElement('canvas');
        canvas.width = LADO;
        canvas.height = LADO;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas no disponible.'));
          return;
        }
        const lado = Math.min(img.width, img.height);
        const sx = (img.width - lado) / 2;
        const sy = (img.height - lado) / 2;
        ctx.drawImage(img, sx, sy, lado, lado, 0, 0, LADO, LADO);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
