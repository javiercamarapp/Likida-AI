import { resumirRequiereAccion } from './requiere-accion';
import type { BandejaEscalaciones } from '@/lib/admin/escalaciones';

/**
 * Los números vivos de las pestañas de /admin. Un mapa `href de la pestaña -> { conteo, atencion }` que el layout (servidor) resuelve y
 * `pestanas-admin.tsx` mezcla sobre el árbol estático de `rutas.ts`. Reglas:
 *   · `conteo: null` = «sin dato» (lectura caída): la pestaña no pinta número. NUNCA se convierte en 0.
 *   · Una pestaña que no está en el mapa no tiene conteo (hoy solo Escalaciones; Tu turno y Aprobaciones las suma la Fase 2).
 *   · `atencion` solo si de verdad hay algo que atender (conteo > 0 y urgencia real de `calcularAlertas`).
 */
export interface ConteoPestana { conteo: number | null; atencion?: boolean }
export type ConteosPestanas = Readonly<Record<string, ConteoPestana>>;

export const SIN_CONTEOS: ConteosPestanas = {};

/** Pura. Escalaciones = las mismas fuentes que suma la campana (`resumirRequiereAccion`), así pestaña y campana no pueden discrepar. */
export function conteosDePestanas(bandeja: Pick<BandejaEscalaciones, 'conteos'> | null): ConteosPestanas {
  if (!bandeja) return SIN_CONTEOS;
  const r = resumirRequiereAccion(bandeja);
  return { '/admin/escalaciones': { conteo: r.pendientes, atencion: r.hayUrgente && (r.pendientes ?? 0) > 0 } };
}
