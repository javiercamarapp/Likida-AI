// ═══════════════════════════════════════════════════════════════════════════
// RESULTADO POR BITÁCORA de `POST /v1/liquidaciones-externas/desgloses` (piloto del webhook, 11-nov-2026) y MODO SIMULACIÓN.
//
// Antes la respuesta solo traía conteos (`recibidas`, `retenidas`, `idempotentes`) y dos listas (`excepciones`, `enRevision`) en las que
// aparecían mezcladas bitácoras NO guardadas y bitácoras SÍ guardadas con avisos: el integrador no podía saber, sin conocer los
// detalles internos, qué bitácora marcar como entregada. Ahora cada bitácora del lote trae su estado explícito:
//
//   recibida              guardada y programada para enviarse.
//   retenida              guardada pero NO sale sin que una persona la libere (póliza provisional, tipo sin regla, neto negativo…).
//   idempotente           ya estaba, con el mismo contenido: no se hizo nada.
//   correccion_pendiente  ya estaba con OTRO contenido: no se sobrescribió; una persona decide. Likida ya tiene una versión.
//   en_revision           NO se guardó: algún dato no pasó la validación (solo formato muestra-tms); corregir y reenviar el mismo ID.
//   no_guardada           NO se guardó: operador sin alta, sin póliza (con la perilla apagada) o bitácora duplicada.
//
// Regla para el integrador (una línea): ENTREGADA = recibida | retenida | idempotente | correccion_pendiente.
// Los campos anteriores de la respuesta no cambian (compatibilidad hacia atrás): `resultados` se SUMA.
//
// MODO SIMULACIÓN: cabecera `Likida-Simular: si`. Valida y responde los mismos `resultados` SIN escribir nada en las tablas de
// desgloses (ni liquidación, ni Excel en Storage, ni entregas, ni excepciones, ni revisiones). La credencial sí se verifica
// como siempre (su «último uso» queda marcado) y cuenta contra el límite de peticiones.
// ═══════════════════════════════════════════════════════════════════════════

import type { ResultadoDesglose } from './desglose_recibir';

export const ESTADOS_BITACORA = ['recibida', 'retenida', 'idempotente', 'correccion_pendiente', 'en_revision', 'no_guardada'] as const;
export type EstadoBitacora = (typeof ESTADOS_BITACORA)[number];

/** Estados que significan «Likida ya tiene esta bitácora»: el integrador la marca como entregada y no la reenvía. */
export const ESTADOS_ENTREGADA: ReadonlySet<EstadoBitacora> = new Set<EstadoBitacora>(['recibida', 'retenida', 'idempotente', 'correccion_pendiente']);

export interface MotivoResultado { codigo: string; campo?: string }

export interface ResultadoBitacoraApi {
  /** Posición de la bitácora en el lote enviado (0 = primera). */
  indice: number;
  /** El identificador interno (`BitacoraID`) como texto; `null` si no se pudo leer. */
  bitacora: string | null;
  /** El `Folio` (número que conoce el operador), solo si vino. */
  folio?: string;
  estado: EstadoBitacora;
  motivos?: MotivoResultado[];
}

const unicos = (xs: readonly string[]): string[] => [...new Set(xs)];

/** Estado y motivos de lo que hizo `recibirDesglose` (también en simulación). */
export function estadoDeRecepcion(r: ResultadoDesglose): { estado: EstadoBitacora; motivos: MotivoResultado[] } {
  switch (r.estado) {
    case 'creada': {
      const codigos = unicos([...r.motivos, ...r.excepciones, ...(r.omitida ? [r.omitida] : [])]);
      return { estado: r.retenida ? 'retenida' : 'recibida', motivos: codigos.map((codigo) => ({ codigo })) };
    }
    case 'simulada': {
      const codigos = unicos([...(r.motivos ?? []), ...(r.omitida ? [r.omitida] : [])]);
      return { estado: r.retenida ? 'retenida' : 'recibida', motivos: codigos.map((codigo) => ({ codigo })) };
    }
    case 'idempotente': return { estado: 'idempotente', motivos: [] };
    case 'correccion_pendiente': return { estado: 'correccion_pendiente', motivos: [{ codigo: 'correccion_pendiente' }] };
    case 'operador_no_encontrado': return { estado: 'no_guardada', motivos: [{ codigo: 'operador_no_encontrado' }] };
    case 'sin_poliza': return { estado: 'no_guardada', motivos: [{ codigo: 'sin_poliza' }] };
  }
}

/** La bitácora ya existe bajo OTRA clave (índice único): no se guardó. */
export function estadoDeConflicto(): { estado: EstadoBitacora; motivos: MotivoResultado[] } {
  return { estado: 'no_guardada', motivos: [{ codigo: 'bitacora_duplicada' }] };
}

export type PeticionSimulacion = { ok: true; simular: boolean } | { ok: false; mensaje: string };

/**
 * `Likida-Simular: si` ⇒ simulación. `no`/`false`/`0`/vacío ⇒ envío normal. Cualquier otro valor es un 400: no se adivina, porque
 * entender mal una cabecera de simulación como «normal» ESCRIBIRÍA datos que el integrador creía no estar guardando.
 */
export function leerSimulacion(cabecera: string | null): PeticionSimulacion {
  if (cabecera === null) return { ok: true, simular: false };
  const v = cabecera.trim().toLowerCase();
  if (v === 'si' || v === 'sí' || v === 'true' || v === '1') return { ok: true, simular: true };
  if (v === '' || v === 'no' || v === 'false' || v === '0') return { ok: true, simular: false };
  return { ok: false, mensaje: 'La cabecera `Likida-Simular` solo admite `si` (simular, no se escribe nada) o `no`.' };
}
