import { TIPOS_HITO } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-41 — EL CICLO DE HITOS POR TIPO DE SERVICIO (0807). Puro, sin I/O.
//
// El cliente distingue importación, exportación y nacional, y cada uno sigue su propia secuencia de estatus (R22/R23): la carga
// y la descarga no pesan igual en cada uno. Este módulo dice QUÉ pasos tiene cada servicio; no mueve la máquina de estados
// (`maquina.ts`, que consume esto en T-A5-42) ni toca los cinco hitos actuales (`TIPOS_HITO`).
//
// Reglas:
//   · Una flota SIN filas de ciclo (o sin filas activas para ese servicio, o con servicio aún desconocido) usa el ciclo ACTUAL: los
//     cinco hitos de siempre. Cero regresión.
//   · La SEMILLA de abajo es sintética y es PROPUESTA hasta recibir la hoja de estatus por servicio del cliente (BLOQUEO EXTERNO,
//     A5-5): no es el mapeo del cliente ni se aplica sola a ninguna flota.
//   · Importación NO pide hitos de carga; exportación sí. La «llegada a destino» de la libreta está tachada: se dice «llegada a
//     cliente». Rampa y espera de descarga solo existen en importación.
// ═══════════════════════════════════════════════════════════════════════════

export const SERVICIOS = ['importacion', 'exportacion', 'nacional'] as const;
export type Servicio = typeof SERVICIOS[number];

export function esServicio(v: unknown): v is Servicio {
  return typeof v === 'string' && (SERVICIOS as readonly string[]).includes(v);
}

/** El vocabulario de pasos del ciclo por servicio. Los cinco hitos actuales caben en él (mismos nombres). */
export const PASOS_CICLO = [
  'confirmar', 'enlace_origen_destino', 'inicio_viaje', 'inicio_viaje_cliente', 'llegada_cliente', 'llegada_cita_carga',
  'contacto', 'rampa', 'espera_descarga', 'inicio_carga', 'fin_carga', 'salida_destino', 'fin_descarga', 'resultado_descarga',
  'patio_entrega', 'llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso',
] as const;
export type PasoCiclo = typeof PASOS_CICLO[number];

export function esPasoCiclo(v: unknown): v is PasoCiclo {
  return typeof v === 'string' && (PASOS_CICLO as readonly string[]).includes(v);
}

/** Los pasos que pertenecen a la CARGA de la caja. */
const PASOS_DE_CARGA: ReadonlySet<PasoCiclo> = new Set<PasoCiclo>([
  'llegada_cita_carga', 'inicio_carga', 'fin_carga', 'llegada_carga', 'salida_carga',
]);

export function esPasoDeCarga(p: PasoCiclo): boolean {
  return PASOS_DE_CARGA.has(p);
}

/** Una fila de `ciclo_servicio`, ya en camelCase. */
export interface CicloServicioFila {
  tenantId: string;
  servicio: Servicio;
  orden: number;
  hito: PasoCiclo;
  activo: boolean;
}

/** Un paso de la semilla, sin flota. */
export type PasoSemilla = Pick<CicloServicioFila, 'servicio' | 'orden' | 'hito'>;

const IMPORTACION: readonly PasoCiclo[] = [
  'confirmar', 'inicio_viaje', 'llegada_cliente', 'contacto', 'rampa', 'espera_descarga', 'fin_descarga', 'resultado_descarga',
];
const EXPORTACION: readonly PasoCiclo[] = [
  'confirmar', 'enlace_origen_destino', 'inicio_viaje_cliente', 'llegada_cita_carga', 'contacto', 'inicio_carga', 'fin_carga',
  'salida_destino', 'patio_entrega',
];
// Nacional: la propuesta conserva los cinco hitos actuales y antepone confirmar e inicio de viaje (el cliente aún no dictó su hoja).
const NACIONAL: readonly PasoCiclo[] = ['confirmar', 'inicio_viaje', ...TIPOS_HITO];

/**
 * LA SEMILLA SINTÉTICA, «propuesta hasta recibir la hoja de estatus» del cliente (libreta 15-oct, reunión de seguimiento).
 * Importación: confirmar → inicio de viaje → llegada a cliente → contacto → rampa → espera de descarga (2 h) → fin de descarga →
 * resultado de la descarga / caja cargada a patio. Exportación: confirmar → enlace de origen y destino → inicio de viaje a cliente →
 * llegada a cita de carga → contacto → inicio y fin de carga → salida a destino → patio de entrega.
 */
export const ETIQUETA_SEMILLA = 'propuesta hasta recibir la hoja de estatus del cliente';
export const SEMILLA_CICLOS: readonly PasoSemilla[] = [
  ...IMPORTACION.map((hito, i) => ({ servicio: 'importacion' as const, orden: i + 1, hito })),
  ...EXPORTACION.map((hito, i) => ({ servicio: 'exportacion' as const, orden: i + 1, hito })),
  ...NACIONAL.map((hito, i) => ({ servicio: 'nacional' as const, orden: i + 1, hito })),
];

export interface CicloEfectivo {
  /** `flota` = lo configurado por la flota; `actual` = el ciclo de cinco hitos de siempre. */
  origen: 'flota' | 'actual';
  servicio: Servicio | null;
  pasos: readonly PasoCiclo[];
}

/** El ciclo de siempre: los cinco hitos fijos. */
export function cicloActual(servicio: Servicio | null = null): CicloEfectivo {
  return { origen: 'actual', servicio, pasos: [...TIPOS_HITO] };
}

/**
 * El ciclo que sigue un viaje de `servicio` en una flota con estas `filas`. Solo cuentan las activas del servicio, por `orden`.
 * Sin servicio conocido, o sin filas activas para él, es el ciclo actual (cero regresión).
 */
export function cicloDelServicio(filas: readonly CicloServicioFila[], servicio: Servicio | null): CicloEfectivo {
  if (servicio === null) return cicloActual(null);
  const activas = filas.filter((f) => f.servicio === servicio && f.activo).sort((a, b) => a.orden - b.orden);
  if (activas.length === 0) return cicloActual(servicio);
  return { origen: 'flota', servicio, pasos: activas.map((f) => f.hito) };
}

/** ¿Este ciclo pide algún paso de carga? Importación no; exportación sí; el actual sí (llegada y salida de carga). */
export function pideHitosDeCarga(ciclo: CicloEfectivo): boolean {
  return ciclo.pasos.some(esPasoDeCarga);
}

/** El primer paso del ciclo que aún no se ha cumplido (en el orden del ciclo), o `null` si ya están todos. */
export function siguientePaso(ciclo: CicloEfectivo, cumplidos: ReadonlySet<PasoCiclo>): PasoCiclo | null {
  return ciclo.pasos.find((p) => !cumplidos.has(p)) ?? null;
}

/** Valida una secuencia antes de guardarla: pasos conocidos y sin repetir. Devuelve el motivo o `null` si es válida. */
export function validarSecuencia(pasos: readonly string[]): string | null {
  if (pasos.length === 0) return 'la secuencia está vacía';
  const vistos = new Set<string>();
  for (const p of pasos) {
    if (!esPasoCiclo(p)) return `paso desconocido: ${p}`;
    if (vistos.has(p)) return `paso repetido: ${p}`;
    vistos.add(p);
  }
  return null;
}

/** Las filas que se insertan al sembrar una flota con la semilla (cada una activa). */
export function filasDeSemilla(tenantId: string): Array<{ tenant_id: string; servicio: Servicio; orden: number; hito: PasoCiclo; activo: true }> {
  return SEMILLA_CICLOS.map((p) => ({ tenant_id: tenantId, servicio: p.servicio, orden: p.orden, hito: p.hito, activo: true as const }));
}
