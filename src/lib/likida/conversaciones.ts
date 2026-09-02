// ═══════════════════════════════════════════════════════════════════════════
// LOS HILOS DE WHATSAPP DE **UNA** FLOTA.
//
// AUDITORÍA 20, hallazgo 6 (MEDIO): `getConversacionesActivas` (lib/admin/
// negocio.ts) lee `wa_conversacion` SIN filtro de tenant —a propósito: es la
// consola cruzada del superadmin— y era el ÚNICO lector del producto. O sea:
// el proveedor podía leer la conversación del chofer de cualquier flota, y el
// dueño de esa flota no podía leer la de SU PROPIO chofer.
//
// El escenario que lo hace un hueco y no una comodidad: el chofer alega "el
// bot me dijo que ya estaba liquidado". El dueño no tiene cómo verificarlo;
// tiene que pedírnoslo a nosotros. Un dato del tenant consultable solo por el
// proveedor no es un dato del tenant.
//
// ESTE MÓDULO ES EL LECTOR ACOTADO, y vive aparte de `lib/admin/negocio.ts`
// por la misma razón por la que aquél vive en `lib/admin`: ahí es donde la
// casa guarda lo que cruza tenants. Lo de aquí NUNCA cruza —`tenant_id` es
// obligatorio en la firma y va en un `.eq()` de la consulta— y hay una prueba
// (`conversaciones_aislamiento.test.ts`) que lo fija.
//
// El filtro `.eq('tenant_id', …)` también deja fuera las filas con
// `tenant_id` NULL (así funciona `=` en SQL, y ésa es exactamente la
// semántica que queremos): una conversación que el webhook no pudo atribuir a
// ninguna flota no es de NINGUNA flota, y enseñársela a la primera que
// pregunte sería inventarle un dueño.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';

export interface TurnoHilo { role: 'user' | 'assistant'; content: string }

export interface HiloWhatsApp {
  /** El número con el que habla el bot. Es la llave real de la fila. */
  telefono: string;
  /** Nombre del operador, cuando la conversación quedó ligada a uno. `null`
   *  = un número de la flota que todavía no empata con un operador (una
   *  cuenta de oficina, o un chofer dado de alta después). */
  operadorNombre: string | null;
  /** Folio del viaje sobre el que se estaba hablando, si lo hay. */
  viajeFolio: string | null;
  /** La ventana rodante de turnos que `conv.ts` guarda en `estado.turns` —
   *  NO es el historial completo: Likida conserva los últimos, no todo. */
  turns: TurnoHilo[];
  actualizadaEn: string;
}

/**
 * Cuántos hilos se LISTAN. Es un TOPE, no un total: el conteo real sale de
 * `contarHilosDeFlota` y la pantalla dice "N de M". Un tope pintado como
 * total es el defecto FE-9 que ya se corrigió una vez en /admin.
 */
export const TOPE_HILOS = 30;

/** Los turnos, si la fila los trae con la forma que `conv.ts` escribe. */
function turnosDe(estado: unknown): TurnoHilo[] {
  const t = (estado as { turns?: unknown } | null)?.turns;
  if (!Array.isArray(t)) return [];
  return t.filter((x): x is TurnoHilo => {
    const o = x as { role?: unknown; content?: unknown };
    return (o?.role === 'user' || o?.role === 'assistant') && typeof o?.content === 'string';
  });
}

/**
 * Los hilos más recientes de ESTA flota, del más nuevo al más viejo.
 *
 * LANZA si la lectura falla. Una lista vacía en esta pantalla afirma "el bot
 * no ha hablado con ninguno de tus choferes", y ésa no se puede decir cuando
 * lo que pasó es que la base no contestó.
 */
export async function getHilosDeFlota(tenantId: string): Promise<HiloWhatsApp[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('wa_conversacion')
    .select('telefono, estado, updated_at, operador:operador_id(nombre), viaje:viaje_id(folio)')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    // Desempate TOTAL por la llave: `updated_at` empata (dos hilos tocados en
    // el mismo instante por la misma ráfaga de webhooks es lo normal, no lo
    // raro), y un `.limit()` que corta a mitad de un empate devuelve un
    // conjunto distinto en cada recarga. Aquí eso sería un hilo que aparece y
    // desaparece de la lista sin que nadie toque nada.
    .order('id')
    .limit(TOPE_HILOS), 'getHilosDeFlota');
  if (error) throw new Error(`getHilosDeFlota: ${error.message}`);

  return (data ?? []).map((c) => ({
    telefono: String(c.telefono),
    operadorNombre: ((c.operador as { nombre?: string } | null)?.nombre) ?? null,
    viajeFolio: ((c.viaje as { folio?: string } | null)?.folio) ?? null,
    turns: turnosDe(c.estado),
    actualizadaEn: String(c.updated_at),
  }));
}

/**
 * Cuántos hilos tiene la flota DE VERDAD (`count exact, head`).
 *
 * `null` = no se pudo contar. Nunca 0: un cero aquí se leería como "el bot no
 * está hablando con nadie", que es justo lo que la pantalla contesta.
 */
export async function contarHilosDeFlota(tenantId: string): Promise<number | null> {
  const { count, error } = await acotada(supabaseAdmin()
    .from('wa_conversacion')
    .select('telefono', { count: 'exact', head: true })
    .eq('tenant_id', tenantId), 'contarHilosDeFlota');
  if (error) {
    logger.warn('contarHilosDeFlota', { tenantId, err: error.message });
    return null;
  }
  return count ?? null;
}
