// La decisión de «¿toca refrescar el tablero ahora?» del temporizador de `actualizar_solo.tsx`, pura para probarla sin DOM.
export const CADA_SEG_POR_OMISION = 60;
const CAMPOS_DE_ENTRADA = ['INPUT', 'SELECT', 'TEXTAREA'];

export function puedeRefrescar(e: { forzar: boolean; visible: boolean; tagActivo: string | null; refrescando: boolean }): boolean {
  if (e.refrescando) return false;       // una petición a la vez
  if (e.forzar) return true;             // «Actualizar ahora» siempre puede
  if (!e.visible) return false;          // pestaña oculta: no se gasta
  if (e.tagActivo && CAMPOS_DE_ENTRADA.includes(e.tagActivo.toUpperCase())) return false;   // alguien escribe o tiene un menú abierto
  return true;
}
