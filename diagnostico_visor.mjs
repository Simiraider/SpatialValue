import sql from './src/Backend/carga.js';
import { sincronizarConKiri } from './src/Backend/visor-kiri.js';

async function diagnosticar() {
  try {
    console.log('🔍 Buscando el último trabajo...');
    const trabajos = await sql`
      SELECT id, estado, etapa, proveedor_ref, modelo_path 
      FROM visor3d_trabajos 
      ORDER BY creado_en DESC 
      LIMIT 1
    `;

    if (trabajos.length === 0) {
      console.log('❌ No se encontraron trabajos en la base de datos.');
      return;
    }

    const t = trabajos[0];
    console.log('📍 Trabajo encontrado:');
    console.log(`   ID: ${t.id}`);
    console.log(`   Estado: ${t.estado}`);
    console.log(`   Etapa: ${t.etapa}`);
    console.log(`   KIRI Ref: ${t.proveedor_ref}`);
    console.log(`   Modelo Path: ${t.modelo_path || 'No existe'}`);

    if (t.estado !== 'listo' && t.proveedor_ref) {
      console.log('⚙️ Intentando forzar sincronización con KIRI...');
      const resultado = await sincronizarConKiri(t);
      console.log('✅ Sincronización completada:', resultado);
    } else if (t.estado === 'listo') {
      console.log('✅ El modelo ya figura como listo en la DB. El problema podría ser el visor o Supabase.');
    } else {
      console.log('⚠️ No se puede sincronizar: falta la referencia de KIRI o ya está listo.');
    }
  } catch (e) {
    console.error('💥 Error durante el diagnóstico:', e);
  }
}

diagnosticar();
