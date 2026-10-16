import { VELOCIDAD_MARCHA_KMH, type SenalExtra } from './compuerta_movimiento';

// ═══════════════════════════════════════════════════════════════════════════
// SEÑALES DE CONDUCCIÓN DEL PROVEEDOR DE TELEMÁTICA (T-A5-65) — spike, sin red ni credenciales.
//
// Requisito del cliente: al chofer no se le escribe en marcha. Una detención por tráfico o semáforo no es «estacionado», y si
// el proveedor ya detecta «teléfono en la mano» el monitoreo del cliente levanta una incidencia al chofer. Este módulo define el
// PUERTO `SenalesConduccion` (qué necesita la compuerta del proveedor) y lo traduce a `SenalExtra`, la entrada opcional de
// `puedeEscribirAlChofer` (T-A5-36). Qué campos expone cada proveedor: `docs/operacion/senales-conduccion.md`.
//
// Garantías: nace apagado (`senalesApagadas` nunca entrega señal y la compuerta cae a la regla solo-GPS, la más conservadora);
// una lectura vieja, futura, sin hora o un fallo del proveedor también cae a solo-GPS (nunca se frena ni se libera a nadie por
// una señal rancia); no registra nada, así que no hay coordenadas en logs. El adaptador real por proveedor NO existe (bloqueo
// externo: campos reales de su cuenta); el cableado al flujo del chofer es T-A5-68.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que el proveedor dice de una unidad en un instante. `null` = no lo reporta (no es lo mismo que apagado/falso). */
export interface LecturaConduccion {
  ignicion: boolean | null;
  /** Velocidad sostenida (km/h). */
  velocidadKmh: number | null;
  /** Evento reciente de «teléfono en la mano» detectado por el proveedor (cámara o sensor). */
  telefonoEnMano: boolean | null;
  /** Hora en que el proveedor midió; `null` = no se sabe → la lectura no vale. */
  medidaEn: Date | null;
}

export interface SenalesConduccion {
  /** Lectura más reciente de la unidad, o `null` si el proveedor no tiene nada. */
  leer(unidadId: string, ahora: Date): Promise<LecturaConduccion | null>;
}

/** «Teléfono en la mano» se expresa como velocidad de marcha: la compuerta exige estrictamente MÁS que `VELOCIDAD_MARCHA_KMH`. */
export const VELOCIDAD_POR_TELEFONO_KMH = VELOCIDAD_MARCHA_KMH + 1;
/** Minutos que una lectura sigue valiendo; pasado esto se descarta y rige solo-GPS. Recalibrar con datos reales. */
export const VIGENCIA_SENAL_MIN = 10;
/** Una medida con hora posterior a `ahora` + esto es de un reloj adelantado y no prueba nada. */
export const FUTURO_TOLERADO_SENAL_MIN = 2;

const finitoNoNegativo = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Traduce una lectura a la `SenalExtra` de la compuerta; `null` = sin señal utilizable (regla solo-GPS).
 *
 * Ruling: «teléfono en la mano» no tiene campo propio en `SenalExtra` (`compuerta_movimiento.ts` ya está integrada y no es de esta
 * tarea): se expresa como velocidad de marcha, de modo que la compuerta responde `conduciendo` también dentro de un sitio. Costo si
 * me equivoco: la razón sale rotulada «conduciendo» y no «teléfono»; el efecto (no escribir) es el mismo y reversible.
 */
export function aSenalExtra(lectura: LecturaConduccion | null | undefined, ahora: Date): SenalExtra | null {
  if (!lectura || !(lectura.medidaEn instanceof Date)) return null;
  const t = lectura.medidaEn.getTime();
  const edadMin = (ahora.getTime() - t) / 60_000;
  if (!Number.isFinite(edadMin) || edadMin > VIGENCIA_SENAL_MIN || edadMin < -FUTURO_TOLERADO_SENAL_MIN) return null;

  const velocidad = finitoNoNegativo(lectura.velocidadKmh) ? lectura.velocidadKmh : null;
  const ignicion = typeof lectura.ignicion === 'boolean' ? lectura.ignicion : null;
  if (lectura.telefonoEnMano === true) return { ignicion, velocidadKmh: Math.max(velocidad ?? 0, VELOCIDAD_POR_TELEFONO_KMH) };
  return { ignicion, velocidadKmh: velocidad };
}

/**
 * Lee del puerto y traduce, sin lanzar nunca: puerto ausente, fallo del proveedor o lectura inservible → `null` (solo-GPS).
 * Es lo que invocará el flujo del chofer (T-A5-68) para alimentar `senalExtra` de `puedeEscribirAlChofer`.
 */
export async function leerSenalExtra(puerto: SenalesConduccion | null | undefined, unidadId: string, ahora: Date): Promise<SenalExtra | null> {
  if (!puerto) return null;
  try {
    return aSenalExtra(await puerto.leer(unidadId, ahora), ahora);
  } catch {
    return null;
  }
}

/** Puerto por omisión (nace apagado): ningún proveedor conectado → sin señal → solo-GPS. */
export const senalesApagadas: SenalesConduccion = { leer: async () => null };

/** Doble de prueba: lecturas sintéticas por unidad; una unidad desconocida devuelve `null`. */
export function crearDobleSenales(porUnidad: Readonly<Record<string, LecturaConduccion>>): SenalesConduccion {
  return { leer: async (unidadId) => porUnidad[unidadId] ?? null };
}

// ── Capacidades por proveedor: lo que el lector del repo YA extrae; nada verificado contra una cuenta viva ──────────────────
export interface CapacidadCampo {
  /** ¿El lector del repo hoy lo extrae del proveedor? (`conectores/posiciones*.ts`, `conectores/tabla_propia`) */
  enRepo: boolean;
  /** ¿Se probó contra una cuenta real? Siempre `false` mientras no haya cuenta (bloqueo externo). */
  verificadoEnVivo: boolean;
}
export interface CapacidadesProveedor { ignicion: CapacidadCampo; velocidad: CapacidadCampo; telefonoEnMano: CapacidadCampo }

const si: CapacidadCampo = { enRepo: true, verificadoEnVivo: false };
const no: CapacidadCampo = { enRepo: false, verificadoEnVivo: false };

export const CAPACIDADES_PROVEEDOR: Readonly<Record<string, CapacidadesProveedor>> = {
  wialon: { ignicion: no, velocidad: si, telefonoEnMano: no },
  geotab: { ignicion: no, velocidad: si, telefonoEnMano: no },
  navixy: { ignicion: si, velocidad: si, telefonoEnMano: no },
  samsara: { ignicion: no, velocidad: si, telefonoEnMano: no },
  /** Según el mapeo que declare la flota (`velocidad`/`ignicion` son opcionales en su vista). */
  tabla_propia: { ignicion: si, velocidad: si, telefonoEnMano: no },
};
