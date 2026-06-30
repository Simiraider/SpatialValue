/**
 * Navegación entre páginas en Astro (MPA).
 * Recarga completa de página — comportamiento estándar para sitios multi-página.
 */

export function navigate(url: string) {
  window.location.href = url;
}

export function goBack() {
  window.history.back();
}
