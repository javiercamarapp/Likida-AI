// ═══════════════════════════════════════════════════════════════════════════
// LECTOR DE ASIGNACIÓN DEL SISTEMA DE SEGUIMIENTO DEL CLIENTE (T-A5-62) — spike, sin red ni credenciales.
//
// Requisito del cliente: al asignarse el viaje, el sistema de seguimiento ya trae instrucciones, ruta, detenciones y coordenadas
// del destino; leerlo evitaría capturarlo de nuevo. «No es algo sencillo, pero sí una integración que se pudiera hacer»: no hay
// API confirmada. Este módulo define SOLO el PUERTO `LectorSeguimiento` (qué necesita el Conductor) y su normalización; qué hay que
// preguntar al cliente: `docs/operacion/lectura-sistema-seguimiento.md`. El GPS en vivo (T-A5-15) y los sitios (T-A5-16) NO se
// duplican aquí: esto es la asignación planeada, no la posición.
//
// Garantías: nace apagado (`lectorSeguimientoApagado` no entrega nada); solo lectura; no hace red; no registra nada (sin coordenadas
// en logs); lo dudoso (lectura vieja, futura, sin hora, coordenadas inválidas) se descarta, nunca se inventa. El adaptador real NO
// existe (bloqueo externo: acceso/API o exportación) y nadie lo invoca aún desde el flujo del chofer.
// ═══════════════════════════════════════════════════════════════════════════

export interface PuntoSeguimiento { lat: number; lng: number }

export interface DetencionSeguimiento extends PuntoSeguimiento {
  /** Posición dentro del viaje (1 = primera). */
  orden: number;
  nombre: string;
}

/** Lo que el sistema de seguimiento dice de un viaje asignado. */
export interface AsignacionSeguimiento {
  /** Referencia del viaje en el sistema del cliente (no se asume que coincida con nuestro folio). */
  viajeRef: string;
  instrucciones: string[];
  ruta: PuntoSeguimiento[];
  detenciones: DetencionSeguimiento[];
  /** Coordenadas del lugar de descarga, o `null` si el sistema no las trae. */
  destino: PuntoSeguimiento | null;
  /** Hora en que se leyó del sistema; `null` = no se sabe → la lectura no vale. */
  leidaEn: Date | null;
}

export interface LectorSeguimiento {
  /** Asignación del viaje, o `null` si el sistema no tiene nada. Solo lectura. */
  leer(viajeRef: string, ahora: Date): Promise<AsignacionSeguimiento | null>;
}

/** Minutos que una asignación leída sigue valiendo; pasado esto se descarta. Recalibrar con la cadencia real del sistema. */
export const VIGENCIA_ASIGNACION_MIN = 30;
/** Una lectura con hora posterior a `ahora` + esto es de un reloj adelantado y no prueba nada. */
export const FUTURO_TOLERADO_ASIGNACION_MIN = 2;

const coordenadaValida = (p: unknown): p is PuntoSeguimiento => {
  if (!p || typeof p !== 'object') return false;
  const { lat, lng } = p as Record<string, unknown>;
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
};

const soloPunto = (p: PuntoSeguimiento): PuntoSeguimiento => ({ lat: p.lat, lng: p.lng });

/**
 * Copia limpia de la asignación, o `null` si no vale (sin hora, vieja, futura o sin referencia de viaje). Devuelve estructuras
 * nuevas: quien la reciba no puede mutar la fuente. Detenciones ordenadas por `orden`; lo que el sistema no trae queda vacío o null.
 */
export function normalizarAsignacion(a: AsignacionSeguimiento | null | undefined, ahora: Date): AsignacionSeguimiento | null {
  if (!a || typeof a.viajeRef !== 'string' || a.viajeRef.trim() === '' || !(a.leidaEn instanceof Date)) return null;
  const edadMin = (ahora.getTime() - a.leidaEn.getTime()) / 60_000;
  if (!Number.isFinite(edadMin) || edadMin > VIGENCIA_ASIGNACION_MIN || edadMin < -FUTURO_TOLERADO_ASIGNACION_MIN) return null;

  const instrucciones = (Array.isArray(a.instrucciones) ? a.instrucciones : [])
    .filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim());
  const ruta = (Array.isArray(a.ruta) ? a.ruta : []).filter(coordenadaValida).map(soloPunto);
  const detenciones = (Array.isArray(a.detenciones) ? a.detenciones : [])
    .filter((d): d is DetencionSeguimiento => coordenadaValida(d) && typeof d.nombre === 'string' && d.nombre.trim() !== '' && Number.isFinite(d.orden))
    .map((d) => ({ orden: d.orden, nombre: d.nombre.trim(), ...soloPunto(d) }))
    .sort((x, y) => x.orden - y.orden);
  const destino = coordenadaValida(a.destino) ? soloPunto(a.destino) : null;
  return { viajeRef: a.viajeRef, instrucciones, ruta, detenciones, destino, leidaEn: new Date(a.leidaEn.getTime()) };
}

/** Lee del puerto y normaliza, sin lanzar nunca: puerto ausente, referencia vacía, fallo del sistema o lectura inservible → `null`. */
export async function leerAsignacionSeguimiento(
  puerto: LectorSeguimiento | null | undefined, viajeRef: string, ahora: Date,
): Promise<AsignacionSeguimiento | null> {
  if (!puerto || typeof viajeRef !== 'string' || viajeRef.trim() === '') return null;
  try {
    return normalizarAsignacion(await puerto.leer(viajeRef, ahora), ahora);
  } catch {
    return null;
  }
}

/** Puerto por omisión (nace apagado): ningún sistema conectado → sin asignación. */
export const lectorSeguimientoApagado: LectorSeguimiento = { leer: async () => null };

/** Doble de prueba: asignaciones sintéticas por referencia de viaje; una desconocida devuelve `null`. */
export function crearDobleSeguimiento(porViaje: Readonly<Record<string, AsignacionSeguimiento>>): LectorSeguimiento {
  return { leer: async (viajeRef) => porViaje[viajeRef] ?? null };
}
