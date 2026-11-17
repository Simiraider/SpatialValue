import { Client, handle_file } from '@gradio/client';
import { 
  actualizarFila, 
  subirObjeto, 
  rutaModelo 
} from './visor-supabase.js';

export async function procesarConMASt3R(trabajoId, archivos) {
  try {
    // 1. Conexión al Space de MASt3R en Hugging Face
    // Usamos skip_api_info para evitar el error 500 de /info
    const client = await Client.connect("naver/MASt3R", { 
      hf_token: process.env.HF_TOKEN,
      skip_api_info: true 
    });

    // 2. Preparar los archivos para el modelo
    // MASt3R espera una lista de imágenes. Enviamos los frames extraídos.
    const inputs = archivos.map(f => handle_file(f));

    try {
      // 3. Ejecutar la reconstrucción
      // Actualizamos la fila para dar feedback al usuario durante la espera
      await actualizarFila(trabajoId, {
        estado: 'procesando',
        mensaje: 'Calculando nubes de puntos y profundidad...',
        progreso: 40,
      });

      const result = await client.predict("/predict", { 
        images: inputs,
      });

      await actualizarFila(trabajoId, {
        estado: 'procesando',
        mensaje: 'Generando malla 3D y optimizando texturas...',
        progreso: 70,
      });

      const glbUrl = result.data[0]; 
      
      if (!glbUrl) throw new Error('MASt3R no devolvió un modelo válido.');

      // 4. Descargar el modelo y subirlo a nuestro Supabase
      const respuesta = await fetch(glbUrl);
      const buffer = await respuesta.arrayBuffer();
      const glbBytes = new Uint8Array(buffer);

      await subirObjeto(rutaModelo(trabajoId), glbBytes, 'model/gltf-binary');

      // 5. Marcar el trabajo como listo
      await actualizarFila(trabajoId, {
        estado: 'listo',
        etapa: 'listo',
        progreso: 100,
        mensaje: 'Modelo 3D reconstruido con éxito',
        modelo_path: rutaModelo(trabajoId),
        modelo_bytes: glbBytes.length,
      });

      return { success: true };
    } catch (e) {
      console.error('Error durante la reconstrucción MASt3R:', e);
      throw e;
    }
  } catch (e) {
    console.error('Error de conexión o general en MASt3R:', e);
    throw e;
  }
}
