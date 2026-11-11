import { resumirRequiereAccion } from './requiere-accion';
import type { BandejaEscalaciones } from '@/lib/admin/escalaciones';
import type { ResumenBandejaCola } from '@/lib/admin/cola-aprobacion';

/**
 * Los números vivos de las pestañas de /admin. Un mapa `href de la pestaña -> { conteo, atencion }` que el layout (servidor) resuelve y
 * `pestanas-admin.tsx` mezcla sobre el árbol estático de `rutas.ts`. Reglas:
 *   · `conteo: null` = «sin dato» (lectura caída): la pestaña no pinta número. NUNCA se convierte en 0.
 *   · Una pestaña que no está en el mapa no tiene conteo (la Bandeja lleva las tres: Tu turno, Aprobaciones y Escalaciones).
 *   · `atencion` solo si de verdad hay algo que atender (conteo > 0 y urgencia real de `calcularAlertas`).
 */
export interface ConteoPestana { conteo: number | null; atencion?: boolean }
export type ConteosPestanas = Readonly<Record<string, ConteoPestana>>;

export const SIN_CONTEOS: ConteosPestanas = {};

/**
 * Pura. Las tres pestañas de la Bandeja salen de las MISMAS lecturas que la campana, así pestaña y campana no pueden discrepar:
 *   · Escalaciones = las fuentes que suma la campana (`resumirRequiereAccion`).
 *   · Aprobaciones = piezas pendientes en `cola_aprobacion`. `atencion` si hay urgentes esperando o si la bandeja ya FRENA al
 *     runner (tope de pendientes o pieza vencida): ahí el dueño es el cuello de botella de los agentes.
 *   · Tu turno = lo que espera al dueño en lo que el layout lee: envíos por aprobar + escalaciones. Las piezas de la Mac y los PR
 *     se leen en la propia pantalla (son lecturas externas que no se hacen en cada navegación), así que el número es un MÍNIMO
 *     verdadero y no los incluye. Si ninguna de las dos lecturas se pudo hacer, `null` («sin dato»), nunca 0.
 * Una lectura caída solo quita SU número: la otra pestaña conserva el suyo.
 */
export function conteosDePestanas(
  bandeja: Pick<BandejaEscalaciones, 'conteos'> | null,
  cola: Pick<ResumenBandejaCola, 'pendientes' | 'urgentes' | 'frenaAlRunner'> | null = null,
): ConteosPestanas {
  const salida: Record<string, ConteoPestana> = {};
  const r = bandeja ? resumirRequiereAccion(bandeja) : null;
  if (r) salida['/admin/escalaciones'] = { conteo: r.pendientes, atencion: r.hayUrgente && (r.pendientes ?? 0) > 0 };
  if (cola) {
    salida['/admin/aprobaciones'] = { conteo: cola.pendientes, atencion: (cola.urgentes > 0 || cola.frenaAlRunner) && cola.pendientes > 0 };
  }
  if (r || cola) {
    const partes = [r?.pendientes ?? null, cola?.pendientes ?? null].filter((n): n is number => n !== null);
    const conteo = partes.length === 0 ? null : partes.reduce((a, b) => a + b, 0);
    const urgente = (r?.hayUrgente ?? false) || (cola ? cola.urgentes > 0 || cola.frenaAlRunner : false);
    salida['/admin/tu-turno'] = { conteo, atencion: urgente && (conteo ?? 0) > 0 };
  }
  return Object.keys(salida).length === 0 ? SIN_CONTEOS : salida;
}
