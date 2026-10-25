// A37-S12-04 — pausar/reanudar era un TOGGLE sobre el estado leído en el
// servidor: con una página vieja que aún decía «Pausar agente», el clic
// REACTIVABA un agente que otro había pausado como freno de emergencia. El
// formulario ahora manda el estado DESEADO y el servidor lo aplica como
// asignación (idempotente), no como inversión.

export type DecisionPausa =
  | { accion: 'cambiar'; activo: boolean }
  | { accion: 'nada' }
  | { accion: 'recargar' };

export function decidirPausa(activoActual: boolean, deseado: FormDataEntryValue | null): DecisionPausa {
  if (deseado !== 'activo' && deseado !== 'pausado') return { accion: 'recargar' };
  const quiereActivo = deseado === 'activo';
  return quiereActivo === activoActual ? { accion: 'nada' } : { accion: 'cambiar', activo: quiereActivo };
}
