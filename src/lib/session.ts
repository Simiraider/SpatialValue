import { getCookie } from './api';

const SV_USER_KEY = 'sv_user';

export interface SesionUsuario {
  nombre: string;
  id?: string;
  demo?: boolean;
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

export function cerrarSesion(redirectTo = '/'): void {
  clearUser();
  document.cookie = 'usuario_id=; Max-Age=0; path=/';
  if (redirectTo) window.location.href = redirectTo;
}

export function syncSessionAcrossTabs(onLogout: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === SV_USER_KEY && !e.newValue) onLogout();
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
