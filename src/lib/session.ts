import { getCookie } from './api';
import { rutaInternaSegura } from './navigate';

export { rutaInternaSegura };

const SV_USER_KEY = 'sv_user';

export interface SesionUsuario {
  nombre: string;
  id?: string;
  demo?: boolean;
  avatar?: string;
  moneda?: 'USD' | 'ARS';
}

export function actualizarSesion(cambios: Partial<SesionUsuario>): SesionUsuario | null {
  const actual = getUser();
  if (!actual) return null;
  const nuevo = { ...actual, ...cambios };
  setUser(nuevo);
  return nuevo;
}

export function getUser(): SesionUsuario | null {
  try {
    const raw = localStorage.getItem(SV_USER_KEY);
    return raw ? (JSON.parse(raw) as SesionUsuario) : null;
  } catch {
    return null;
  }
}

export function setUser(user: SesionUsuario): void {
  localStorage.setItem(SV_USER_KEY, JSON.stringify(user));
}

export function clearUser(): void {
  localStorage.removeItem(SV_USER_KEY);
}

export function getUsuarioId(): string | null {
  return getCookie('usuario_id') || getUser()?.id || null;
}

export function getMoneda(): 'USD' | 'ARS' {
  return getUser()?.moneda ?? 'USD';
}

export function setMoneda(moneda: 'USD' | 'ARS'): void {
  actualizarSesion({ moneda });
}

export function cerrarSesion(redirectTo = '/'): void {
  clearUser();
  document.cookie = 'usuario_id=; Max-Age=0; path=/';
  if (redirectTo) window.location.href = rutaInternaSegura(redirectTo);
}

export function tieneSesion(): boolean {
  return Boolean(getCookie('usuario_id') || getUser());
}

export function exigirSesionEnEnlaces(selector = '[data-requiere-login]'): void {
  document.querySelectorAll<HTMLAnchorElement>(selector).forEach((enlace) => {
    enlace.addEventListener('click', (evento) => {
      if (tieneSesion()) return;
      evento.preventDefault();
      window.location.href = '/login';
    });
  });
}

export function syncSessionAcrossTabs(onLogout: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === SV_USER_KEY && !e.newValue) onLogout();
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
