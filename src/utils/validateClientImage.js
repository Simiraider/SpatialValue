// src/utils/validateClientImage.js
const VALID_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const MIN_LADO_LARGO = 800;
const MIN_LADO_CORTO = 600;

export function validateImageClient(file) {
  return new Promise((resolve) => {
    if (!file || file.size === 0) {
      return resolve({ valid: false, error: 'Sin archivo' });
    }

    if (!VALID_TYPES.includes(file.type)) {
      return resolve({ valid: false, error: 'Formato no válido. Usa JPG, PNG o WEBP.' });
    }

    if (file.size > MAX_SIZE) {
      return resolve({ valid: false, error: 'La imagen supera los 10 MB.' });
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const largo = Math.max(w, h);
      const corto = Math.min(w, h);

      if (largo < MIN_LADO_LARGO || corto < MIN_LADO_CORTO) {
        return resolve({
          valid: false,
          error: `Resolución baja (${w}x${h}px). Mínimo 800x600px.`,
        });
      }
      resolve({ valid: true });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ valid: false, error: 'Imagen dañada o ilegible.' });
    };

    img.src = objectUrl;
  });
}