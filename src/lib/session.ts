import { rutaInternaSegura } from './navigate';

export { rutaInternaSegura };

const SV_USER_KEY = 'sv_user';

export interface SesionUsuario {
  nombre: string;
  id?: string;
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

/**
 * Id del usuario para mostrar datos en pantalla.
 *
 * NO es una credencial: la sesión real vive en una cookie `HttpOnly` que este
 * código nunca puede leer. Cualquier endpoint debe autenticar con
 * `resolverUsuarioId(request)` en el servidor.
 */
export function getUsuarioId(): string | null {
  return getUser()?.id ?? null;
}

export function getMoneda(): 'USD' | 'ARS' {
  return getUser()?.moneda ?? 'USD';
}

export function setMoneda(moneda: 'USD' | 'ARS'): void {
  actualizarSesion({ moneda });
}

export function cerrarSesion(redirectTo = '/'): void {
  clearUser();

  // La cookie es HttpOnly: sólo el servidor puede borrarla.
  try {
    void fetch('/Apis/logout', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
    });
  } catch {
    void 0;
  }

  if (redirectTo) window.location.href = rutaInternaSegura(redirectTo);
}

export function tieneSesion(): boolean {
  return Boolean(getUser());
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
