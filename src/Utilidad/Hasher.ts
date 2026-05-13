import { argon2id } from 'hash-wasm';

export async function hashPassword(password: string) {
  // Generamos un salt aleatorio de 16 bytes
  const salt = crypto.getRandomValues(new Uint8Array(16));
  
  const hash = await argon2id({
    password: password,
    salt: salt, 
    parallelism: 1,
    iterations: 2, // Ajustable según necesidad de seguridad/velocidad
    memorySize: 16384, // 16MB
    hashLength: 32,
    outputType: 'encoded', // Esto genera una cadena que ya incluye el salt y parámetros
  });

  return hash;
}