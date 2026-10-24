import type { ViajeContexto } from './repo';

// ═══════════════════════════════════════════════════════════════════════════
// SEGURIDAD FÍSICA DEL CHOFER — pura, sin I/O (A37-A5-02 y A37-A5-03).
//
// Regla de oro: NADA proactivo le llega a un chofer (ni al jefe «porque no contestó») mientras
//   · tenga una EMERGENCIA abierta (asalto/robo, choque, emergencia médica, bloqueo, o cualquier incidencia crítica). Un bot que
//     escribe es un teléfono que vibra en la mano de alguien a quien están asaltando (ver `asistencia_wa.ts`, «modo mudo»), y la
//     escalación «sin respuesta a N avisos» empujaría al patio a llamar a quien no puede contestar;
//   · esté dado de baja o tenga una OPOSICIÓN ARCO vigente.
// Ante la duda (no se pudo leer la tabla de incidencias) NO se escribe: las lecturas lanzan y el llamador se detiene.
// ═══════════════════════════════════════════════════════════════════════════

/** Tipos de `incidencia` que son una emergencia para el chofer. `varado` (ámbar) NO: respeta la ventana como cualquier aviso. */
export const TIPOS_EMERGENCIA = ['siniestro', 'robo', 'emergencia_medica', 'bloqueo'] as const;

/**
 * Cuánto tiempo una incidencia SIN RESOLVER sigue silenciando al chofer. Una emergencia que nadie cerró en 3 días ya es un expediente
 * olvidado, no un asalto en curso: sin tope, un olvido de la oficina callaría al chofer para siempre.
 */
export const HORAS_EMERGENCIA_VIGENTE = 72;

/** Lo abierto de UNA flota: a quién (operador), qué viaje y qué unidad tienen una emergencia sin resolver. */
export interface EmergenciasFlota {
  operadorIds: ReadonlySet<string>;
  viajeIds: ReadonlySet<string>;
  unidadIds: ReadonlySet<string>;
}

export type EmergenciasPorFlota = ReadonlyMap<string, EmergenciasFlota>;

export interface FilaEmergencia {
  tenant_id: string;
  operador_id: string | null;
  viaje_id: string | null;
  unidad_id: string | null;
}

/** Agrupa las filas de `incidencia` abiertas por flota. */
export function agruparEmergencias(filas: readonly FilaEmergencia[]): Map<string, EmergenciasFlota> {
  const m = new Map<string, { operadorIds: Set<string>; viajeIds: Set<string>; unidadIds: Set<string> }>();
  for (const f of filas) {
    const t = m.get(f.tenant_id) ?? { operadorIds: new Set<string>(), viajeIds: new Set<string>(), unidadIds: new Set<string>() };
    if (f.operador_id) t.operadorIds.add(f.operador_id);
    if (f.viaje_id) t.viajeIds.add(f.viaje_id);
    if (f.unidad_id) t.unidadIds.add(f.unidad_id);
    m.set(f.tenant_id, t);
  }
  return m;
}

/** ¿Este viaje tiene una emergencia abierta (por su operador, por el propio viaje o por su unidad)? */
export function viajeEnEmergencia(v: Pick<ViajeContexto, 'id' | 'tenantId' | 'operadorId' | 'unidadId'>, em: EmergenciasPorFlota): boolean {
  const f = em.get(v.tenantId);
  if (!f) return false;
  return f.operadorIds.has(v.operadorId) || f.viajeIds.has(v.id) || (v.unidadId !== null && f.unidadIds.has(v.unidadId));
}

export interface ViajesAvisables {
  viajes: ViajeContexto[];
  /** Los que se quitaron y por qué (solo conteos: sin datos personales). */
  enEmergencia: number;
  operadorNoAvisable: number;
}

/** Quita de la lista de trabajo los viajes a cuyo chofer NO se le debe escribir (emergencia abierta, baja u oposición). */
export function filtrarViajesAvisables(viajes: readonly ViajeContexto[], em: EmergenciasPorFlota): ViajesAvisables {
  const salida: ViajesAvisables = { viajes: [], enEmergencia: 0, operadorNoAvisable: 0 };
  for (const v of viajes) {
    if (v.operadorAvisable === false) { salida.operadorNoAvisable++; continue; }
    if (viajeEnEmergencia(v, em)) { salida.enEmergencia++; continue; }
    salida.viajes.push(v);
  }
  return salida;
}
