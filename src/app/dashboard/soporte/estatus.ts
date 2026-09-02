// ═══════════════════════════════════════════════════════════════════════════
// CÓMO SE NOMBRA Y DE QUÉ COLOR SE PINTA CADA ESTADO DE TICKET. UNA VEZ.
//
// AUDITORÍA 21 (frontend, MEDIO 1). `PILL_TICKET` vivía privado en
// `/admin/soporte` y `/dashboard/soporte` imprimía `t.estado` crudo: cuando el
// equipo movía un ticket a `en_proceso`, el flota_admin veía la palabra
// "en_proceso" —con el guion bajo— en la columna Estado de su propia bandeja.
// Mismo cierre que `dashboard/estatus.ts` para el estatus de liquidación: las
// dos pantallas son server components del mismo panel, así que un módulo
// compartido lo resuelve de verdad en vez de vigilar dos copias.
//
// El mapa es `Record<EstadoTicket, …>` a propósito (no `Record<string, …>`):
// un estado nuevo en `ESTADOS_TICKET` (lib/likida/soporte.ts, dominio de la
// 0051) sin rótulo aquí NO COMPILA — el patrón de `rotulo-diferencia.ts`.
// ═══════════════════════════════════════════════════════════════════════════
import type { Estado } from '@/app/admin/ui/kit';
import type { EstadoTicket } from '@/lib/likida/soporte';

/** `ticket_soporte.estado` (dominio de la 0051) como pill — mismo criterio
 *  de color que `PILL_ESTATUS` en resumen-visual. */
export const PILL_TICKET: Record<EstadoTicket, { estado: Estado; etiqueta: string }> = {
  abierto: { estado: 'warn', etiqueta: 'Abierto' },
  en_proceso: { estado: 'warn', etiqueta: 'En proceso' },
  esperando: { estado: 'neutral', etiqueta: 'Esperando' },
  resuelto: { estado: 'ok', etiqueta: 'Resuelto' },
  cerrado: { estado: 'ok', etiqueta: 'Cerrado' },
};

/** Un valor fuera del dominio se pinta con su clave cruda en neutro —
 *  visible, no roto, y nunca una etiqueta inventada (mismo contrato que
 *  `etiquetaEstatus` en `dashboard/estatus.ts`). */
export function pillTicket(estado: string): { estado: Estado; etiqueta: string } {
  return PILL_TICKET[estado as EstadoTicket] ?? { estado: 'neutral', etiqueta: estado };
}
