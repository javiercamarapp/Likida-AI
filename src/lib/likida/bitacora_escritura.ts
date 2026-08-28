// ═══════════════════════════════════════════════════════════════════════════
// EL ÚNICO ESCRITOR DE `bitacora_auditoria` (0053).
//
// La auditoría 18 (A1) encontró 17 `insert` escritos a mano —cada módulo con
// su copia del mismo bloque de siete campos— y tres formas distintas de firmar
// al actor: con `actor_id` + `actor_email`, solo con `actor_id`, o sin ninguno.
// Una copia ya se había desincronizado (`facturacion/avisar.ts` escribía la
// entidad equivocada con el id del tenant). Un registro de auditoría cuya
// forma no la garantiza nada se audita a mano, que es cuando ya no sirve.
//
// Aquí vive la forma, UNA vez: la entidad es una unión cerrada, el actor se
// firma siempre con las dos columnas (o se declara `'sistema'` a propósito —
// un cron, una corrida sin persona— y quedan en null DICIÉNDOLO en el código),
// y el fallo es best-effort: la acción que se anota YA ocurrió, y tirarla por
// no poder anotarla deja el sistema peor que sin registro. Se loguea, con el
// evento que cada módulo ya tenía, y se sigue.
//
// El lector es `lib/admin/bitacora.ts` (cross-tenant, a propósito). Una prueba
// estructural falla si reaparece un `.from('bitacora_auditoria').insert(`
// fuera de este archivo.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '@/lib/likida/presupuesto';

/** Lo que `entidad` puede decir. Ampliar AQUÍ, no en el llamador. */
export type EntidadBitacora =
  | 'tenant'
  | 'app_user'
  | 'operador'
  | 'viaje'
  | 'gasto'
  | 'cliente'
  | 'tarifa'
  | 'factura_emitida'
  | 'pago_recibido'
  | 'conector_credencial'
  | 'tenant_api_key'
  | 'campana'
  | 'agente_definicion'
  | 'cola_aprobacion'
  | 'interruptor'
  | 'runner'
  // A19 (0229): las vigilancias que la flota declara en lenguaje natural.
  // Quién confirmó una regla que manda WhatsApps —y quién la pausó— es
  // exactamente la clase de acto que esta tabla existe para recordar.
  | 'regla_vigilancia';

/**
 * Quién lo hizo. `'sistema'` es una decisión, no un olvido: un cron o una
 * corrida de plataforma sin persona detrás. El lector pinta "sistema" cuando
 * las dos columnas son null — y así se distingue en el código el escritor que
 * lo declaró del que olvidó firmar.
 */
export type ActorBitacora =
  | { id?: string | null; email?: string | null }
  | 'sistema';

export interface EntradaBitacora {
  /** `null` cuando la acción es de PLATAFORMA (interruptores, runner, cola). */
  tenantId: string | null;
  actor: ActorBitacora;
  accion: string;
  entidad: EntidadBitacora;
  entidadId: string;
  /** Contexto SIN datos personales ni secretos: la tabla sobrevive a un borrado ARCO. */
  detalle?: Record<string, unknown> | null;
}

export interface OpcionesBitacora {
  /** Evento del log si no se pudo escribir. Por omisión `bitacora.no_escribio`. */
  evento?: string;
  /** Campos extra para ese log (p. ej. `{ interruptor: nombre }`). */
  contexto?: Record<string, unknown>;
}

/** La fila tal como va a la tabla. Exportado para que las pruebas la tipen. */
export interface FilaBitacora {
  tenant_id: string | null;
  actor_id: string | null;
  actor_email: string | null;
  accion: string;
  entidad: EntidadBitacora;
  entidad_id: string;
  detalle: Record<string, unknown> | null;
}

export function filaBitacora(e: EntradaBitacora): FilaBitacora {
  const actor = e.actor === 'sistema' ? null : e.actor;
  return {
    tenant_id: e.tenantId,
    actor_id: actor?.id ?? null,
    actor_email: actor?.email ?? null,
    accion: e.accion,
    entidad: e.entidad,
    entidad_id: e.entidadId,
    detalle: e.detalle ?? null,
  };
}

/**
 * Anota una acción en la bitácora. NUNCA lanza: devuelve `true` si quedó
 * escrita y `false` (ya logueado) si no.
 */
export async function anotarBitacora(
  entrada: EntradaBitacora,
  opciones: OpcionesBitacora = {},
): Promise<boolean> {
  const evento = opciones.evento ?? 'bitacora.no_escribio';
  const contexto = { ...(opciones.contexto ?? {}), accion: entrada.accion };
  try {
    const { error } = await acotada(supabaseAdmin().from('bitacora_auditoria').insert(filaBitacora(entrada)), 'bitacora.insert');
    if (error) {
      logger.warn(evento, { ...contexto, err: error.message });
      return false;
    }
    return true;
  } catch (e) {
    logger.warn(evento, { ...contexto, err: e instanceof Error ? e.message : String(e) });
    return false;
  }
}
