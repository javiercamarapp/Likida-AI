// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 (integración): sacado de `route.ts`. Un `route.ts` de App
// Router solo puede exportar handlers HTTP y la config reconocida por Next
// (`runtime`, `dynamic`, etc.) — cualquier otro export ahí revienta
// `next build` (`.next/types` valida el módulo contra ese contrato). Este
// Map de módulo y su función de reinicio para pruebas viven aquí para poder
// exportarse sin tocar ese contrato.
// ═══════════════════════════════════════════════════════════════════════════

const VENTANA_REPLAY_MS = 10 * 60_000;
/** Techo del Map: por encima se limpia entero. Una entrega son ~40 B de id y
 *  este endpoint no ve más que logins; 5,000 es holgura de sobra. */
const MAX_IDS = 5_000;
const idsMandados = new Map<string, number>();

/** ¿Ya salió el correo de ESTA entrega? Limpia lo vencido de paso. */
export function yaSeMando(id: string): boolean {
  const visto = idsMandados.get(id);
  if (visto === undefined) return false;
  if (Date.now() - visto > VENTANA_REPLAY_MS) { idsMandados.delete(id); return false; }
  return true;
}

export function sellarMandado(id: string): void {
  if (idsMandados.size >= MAX_IDS) idsMandados.clear();
  idsMandados.set(id, Date.now());
}

/** Solo para pruebas: el Map es de módulo y se comparte entre casos. */
export function reiniciarAntiReplay(): void {
  idsMandados.clear();
}
