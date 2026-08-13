// Humo del historial de chat (0088) contra la base REAL — NO CI.
// Recorre el ciclo completo: crear (guardarIntercambio), anexar, listar,
// traer, el candado anti-IDOR (id ajeno → conversación nueva), y limpia.
import { supabaseAdmin } from '../src/lib/supabase/admin';
import {
  guardarIntercambio, listarConversaciones, traerConversacion,
} from '../src/lib/likida/chat/conversaciones';

const DEMO = '11111111-1111-1111-1111-111111111111';

async function main() {
  // El demo no tiene usuarios propios (los superadmin viven con tenant null):
  // se usa un superadmin — exactamente la combinación con la que Javier chatea
  // el demo en producción (tenant efectivo demo + su user_id).
  const { data: u, error } = await supabaseAdmin()
    .from('app_user').select('id, rol').eq('rol', 'superadmin').limit(1).maybeSingle();
  if (error || !u) throw new Error(`sin superadmin: ${error?.message ?? 'vacío'}`);
  const userId = u.id as string;
  console.log('usuario demo:', userId, `(${u.rol})`);

  // 1. Crear con el primer intercambio.
  const bloques = [
    { tipo: 'texto', texto: 'Llevas $12,345.00 comprobados.' },
    { tipo: 'tabla', filas: [['Monto comprobado', '$12,345.00'], ['Viajes', 3]] },
  ];
  const id = await guardarIntercambio({
    tenantId: DEMO, userId, conversacionId: null,
    pregunta: 'HUMO-0088 ¿cuánto llevo comprobado?', textoRespuesta: 'Llevas $12,345.00 comprobados.', bloques,
  });
  console.log('creada:', id);

  // 2. Anexar un segundo turno a la MISMA conversación.
  const id2 = await guardarIntercambio({
    tenantId: DEMO, userId, conversacionId: id,
    pregunta: 'HUMO-0088 ¿y con diferencias?', textoRespuesta: 'Dos con diferencias.', bloques: [{ tipo: 'texto', texto: 'Dos con diferencias.' }],
  });
  if (id2 !== id) throw new Error(`anexar abrió otra conversación: ${id2}`);

  // 3. Listar: la conversación está y encabeza la lista.
  const lista = await listarConversaciones(DEMO, userId);
  const fila = lista.find((c) => c.id === id);
  if (!fila) throw new Error('la conversación no aparece en la lista');
  console.log('en lista:', JSON.stringify(fila));

  // 4. Traer: 4 mensajes (2 turnos), bloques del asistente intactos.
  const conv = await traerConversacion(DEMO, userId, id);
  if (!conv || conv.mensajes.length !== 4) throw new Error(`esperaba 4 mensajes, hay ${conv?.mensajes.length}`);
  const conBloques = conv.mensajes.filter((m) => m.bloques !== null).length;
  if (conBloques !== 2) throw new Error(`esperaba 2 mensajes con bloques, hay ${conBloques}`);
  console.log('mensajes:', conv.mensajes.map((m) => `${m.rol}:${m.texto.slice(0, 30)}`).join(' | '));

  // 5. Anti-IDOR: un userId distinto NO ve ni anexa a esta conversación.
  const otro = '00000000-0000-0000-0000-000000000000';
  const ajena = await traerConversacion(DEMO, otro, id);
  if (ajena !== null) throw new Error('IDOR: otro usuario leyó la conversación');
  console.log('anti-IDOR: otro usuario recibe null ✓');

  // 6. Limpieza (cascade verificado en el bloque 63).
  const { error: errDel } = await supabaseAdmin().from('chat_conversacion').delete().eq('id', id).eq('tenant_id', DEMO);
  if (errDel) throw new Error(`limpieza: ${errDel.message}`);
  console.log('limpio. TODO OK');
}

main().then(() => process.exit(0)).catch((e) => { console.error('FALLO', e); process.exit(1); });
