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
  | 'regla_vigilancia'
  // A18 (0228): el portal de pago del cliente. Quién emitió el enlace de una
  // factura, quién lo revocó, y quién decidió sobre lo que un tercero afirmó
  // haber pagado — los tres son actos que hay que poder reconstruir.
  | 'portal_pago_liga'
  | 'portal_pago_propuesta'
  | 'rep_emitido'
  // 0231: la descarga masiva del SAT. Quién declaró CUÁL RFC se descarga y
  // quién pidió QUÉ periodo son los dos actos que hay que poder reconstruir:
  // el primero decide de qué contribuyente se lee el buzón, y el segundo
  // consume el tope diario que ese RFC tiene ante el SAT.
  | 'sat_descarga_config'
  | 'sat_descarga_solicitud'
  // 0243: la bandeja de conciliación. Ligar un CFDI a un gasto, archivarlo o
  // DESHACER cualquiera de las dos cosas son afirmaciones sobre dinero
  // deducible: «este comprobante ampara este gasto» es lo que el contador va a
  // defender ante el SAT. La anotación vive además EN LA FILA
  // (`resuelto_por_email`) y en el expediente `sat_cfdi_resolucion`; esto es la
  // copia cross-tenant que /admin reconstruye — mismo reparto que `jornada_dia`.
  | 'sat_cfdi_descargado'
  // El permiso de la flota para que Likida guarde su contraseña de portal y
  // reconecte sola (0233). Es un CONSENTIMIENTO: quién lo dio, cuándo, quién
  // lo revocó, y cada vez que la máquina lo ejerció. Sin esto, «reconecté
  // sola el 9 de agosto» sería una frase sin respaldo.
  | 'portal_relogin'
  // 0241: el registro de jornada de la LFT 132 fr. XXXIV. Corregir una hora de
  // un trabajador, o cerrar su día, son actos con consecuencia jurídica: el
  // 805 de la propia LFT hace que la ausencia o el desaseo de este documento se
  // vuelva una presunción en contra del patrón. La anotación vive además EN LA
  // FILA (`anulado_por_email`, `cerrado_por_email`); esto es la copia
  // cross-tenant que /admin puede reconstruir sin tocar el expediente.
  | 'jornada_dia'
  // Comandos de administración de PLATAFORMA recibidos por WhatsApp (0059,
  // `admin_comandos_wa.ts`): "aprobar <id>", "correr <rutina>", "estatus".
  // Van sin tenant (`tenantId: null`, igual que 'cola_aprobacion') porque las
  // tablas que tocan (`cola_aprobacion`, `bus_*`) tampoco tienen una — son de
  // Javier, no de una flota. `entidadId` es el id de la pieza, el nombre de
  // la rutina, o 'general' para un "estatus" sin argumento.
  | 'comando_admin_wa';

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
