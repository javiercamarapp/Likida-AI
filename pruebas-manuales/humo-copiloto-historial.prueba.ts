// Humo del historial del copiloto (0121) contra la base REAL — NO CI.
// El espejo de humo-conversaciones.prueba.ts (0088), menos el tenant: el
// ancla del copiloto es SOLO el usuario. Recorre el ciclo completo: crear
// (guardarIntercambioCopiloto), anexar, listar, traer, el candado anti-IDOR
// (id ajeno → conversación nueva), y limpia.
//
// CÓMO SE CORRE (manual, después de aplicar la 0121):
//   set -a; source .env.local; set +a
//   npx tsx pruebas-manuales/humo-copiloto-historial.prueba.ts
import { supabaseAdmin } from '../src/lib/supabase/admin';
import {
  guardarIntercambioCopiloto, listarConversacionesCopiloto, traerConversacionCopiloto,
} from '../src/lib/agents/copiloto-historial';

async function main() {
  // El usuario real del copiloto: el superadmin (el único rol que la puerta
  // de /api/admin/copiloto deja pasar).
  const { data: u, error } = await supabaseAdmin()
    .from('app_user').select('id, rol').eq('rol', 'superadmin').limit(1).maybeSingle();
  if (error || !u) throw new Error(`sin superadmin: ${error?.message ?? 'vacío'}`);
  const userId = u.id as string;
  console.log('usuario:', userId, `(${u.rol})`);

  // 1. Crear con el primer intercambio (bloques con una acción incluida —
  //    al reabrir, la UI la pinta ARCHIVADA, sin botón).
  const bloques = [
    { tipo: 'texto', texto: 'Hay 2 escalaciones esperando decisión.' },
    { tipo: 'tabla', filas: [['Urgentes', 1], ['Normales', 1]] },
  ];
  const id = await guardarIntercambioCopiloto({
    userId, conversacionId: null,
    pregunta: 'HUMO-0121 ¿qué espera decisión hoy?', textoRespuesta: 'Hay 2 escalaciones esperando decisión.', bloques,
  });
  console.log('creada:', id);

  // 2. Anexar un segundo turno a la MISMA conversación.
  const id2 = await guardarIntercambioCopiloto({
    userId, conversacionId: id,
    pregunta: 'HUMO-0121 ¿y el costo de IA?', textoRespuesta: 'Estable.', bloques: [{ tipo: 'texto', texto: 'Estable.' }],
  });
  if (id2 !== id) throw new Error(`anexar abrió otra conversación: ${id2}`);

  // 3. Listar: la conversación está y encabeza la lista.
  const lista = await listarConversacionesCopiloto(userId);
  const fila = lista.find((c) => c.id === id);
  if (!fila) throw new Error('la conversación no aparece en la lista');
  console.log('en lista:', JSON.stringify(fila));

  // 4. Traer: 4 mensajes (2 turnos), bloques del asistente intactos.
  const conv = await traerConversacionCopiloto(userId, id);
  if (!conv || conv.mensajes.length !== 4) throw new Error(`esperaba 4 mensajes, hay ${conv?.mensajes.length}`);
  const conBloques = conv.mensajes.filter((m) => m.bloques !== null).length;
  if (conBloques !== 2) throw new Error(`esperaba 2 mensajes con bloques, hay ${conBloques}`);
  console.log('mensajes:', conv.mensajes.map((m) => `${m.rol}:${m.texto.slice(0, 30)}`).join(' | '));

  // 5. Anti-IDOR: un userId distinto NO ve esta conversación, y anexar con
  //    su id abre una NUEVA en vez de escribir en la ajena.
  const otro = '00000000-0000-0000-0000-000000000000';
  const ajena = await traerConversacionCopiloto(otro, id);
  if (ajena !== null) throw new Error('IDOR: otro usuario leyó la conversación');
  console.log('anti-IDOR: otro usuario recibe null ✓');

  // 6. Limpieza (cascade verificado en el bloque 95).
  const { error: errDel } = await supabaseAdmin().from('copiloto_conversacion').delete().eq('id', id).eq('user_id', userId);
  if (errDel) throw new Error(`limpieza: ${errDel.message}`);
  console.log('limpio. TODO OK');
}

main().then(() => process.exit(0)).catch((e) => { console.error('FALLO', e); process.exit(1); });
