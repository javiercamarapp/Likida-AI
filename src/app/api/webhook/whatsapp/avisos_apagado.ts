// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 (integración): sacado de `route.ts`. Un `route.ts` de App
// Router solo puede exportar handlers HTTP y la config reconocida por Next
// (`runtime`, `dynamic`, etc.) — cualquier otro export ahí revienta
// `next build` (`.next/types` valida el módulo contra ese contrato). El Map
// de módulo (AGEN-7) y su función de reinicio para pruebas viven aquí para
// poder exportarse sin tocar ese contrato.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A quién ya se le dijo que estamos en mantenimiento, y cuándo (AGEN-7).
 * En memoria del módulo a propósito: ver el comentario del llamador.
 */
export const avisadosDeApagado = new Map<string, number>();
/** Media hora: un apagado más largo que eso merece que se lo recuerden. */
export const VENTANA_AVISO_APAGADO_MS = 30 * 60 * 1000;

/** Solo para pruebas: el Map es de módulo y se comparte entre casos. */
export function olvidarAvisosDeApagado(): void {
  avisadosDeApagado.clear();
}
