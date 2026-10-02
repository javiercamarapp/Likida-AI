// ═══════════════════════════════════════════════════════════════════════════
// EL MODELO COMÚN DE POSICIONES Y LO QUE COMPARTEN TODOS LOS LECTORES.
//
// Cada proveedor de GPS habla su dialecto (Wialon: `pos.y/x/s/c/t`; Geotab:
// `DeviceStatusInfo`; Navixy: `state.gps.location`; Samsara: `gps.latitude`).
// Este archivo define la ÚNICA forma que cruza hacia el poller y hacia la tabla
// `posicion`: unidad (id del dispositivo), lat/lon, velocidad en km/h, rumbo,
// ignición y fecha UTC en ISO. Todo lo demás (tokens, sesiones, paginación) se
// queda dentro del lector de cada proveedor.
// ═══════════════════════════════════════════════════════════════════════════
import type { Http, PeticionHttp, RespuestaHttp } from './tipos';

/** Una lectura de GPS, ya normalizada. */
export interface PosicionLeida {
  /** Id del dispositivo EN EL SISTEMA DEL PROVEEDOR. Se liga vía unidad.gps_device_id. */
  deviceId: string;
  lat: number;
  lng: number;
  /** ISO UTC. Es la hora que declara el proveedor, no la de recepción. */
  medidaEn: string;
  /** km/h. `null` cuando el proveedor no la da. */
  velocidad: number | null;
  /** Grados. `null` cuando no viene. */
  rumbo: number | null;
  /** Ignición. `null` = el proveedor no la reporta (no es lo mismo que apagada). */
  ignicion?: boolean | null;
}

/**
 * POR QUÉ FALLÓ una lectura. Decide qué se le dice a la flota y cómo se espacian
 * los reintentos:
 *  · `credencial` — token/usuario rechazado o vencido: reintentar cada 5 min no
 *    lo arregla y puede bloquear la cuenta del cliente. Backoff largo.
 *  · `proveedor`  — caída, 5xx, límite de tasa: transitorio. Backoff corto.
 *  · `formato`    — contestó 200 con algo que no es lo que su documentación
 *    promete: nuestro mapeo o su API cambió. Backoff largo y se dice.
 */
export type FallaLectura = 'credencial' | 'proveedor' | 'formato';

export type ResultadoPosiciones =
  | {
      ok: true; posiciones: PosicionLeida[]; paginas: number; completo: true; invalidas: number;
      /** Unidades que el proveedor lista pero que aún no reportan posición. No son error. */
      sinPosicion?: number;
    }
  | { ok: false; motivo: string; paginas?: number; backlog?: boolean; falla?: FallaLectura };

export interface OpcionesLecturaPaginada {
  /** Instante absoluto tras el que no se abre otra petición ni se duerme. */
  venceEn?: number;
  ahora?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

export const MAX_PAGINAS_DEFENSIVO = 1_000;
const MAX_REINTENTOS_429 = 3;
const MAX_REINTENTOS_5XX = 3;

export function retryAfterMs(valor: string | undefined, ahora: number): number {
  if (!valor) return 1_000;
  const segundos = Number(valor);
  if (Number.isFinite(segundos) && segundos >= 0) return Math.min(segundos * 1_000, 30_000);
  const fecha = Date.parse(valor);
  if (!Number.isFinite(fecha)) return 1_000;
  return Math.min(Math.max(0, fecha - ahora), 30_000);
}

/** Una lectura sin coordenadas válidas no es una lectura: se descarta. */
export function coordenadaValida(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    // (0,0) es el Golfo de Guinea: lo que devuelve un dispositivo sin señal.
    !(lat === 0 && lng === 0)
  );
}

export interface Reloj {
  ahora: () => number;
  dormir: (ms: number) => Promise<void>;
  venceEn?: number;
}

export function relojDe(o: OpcionesLecturaPaginada): Reloj {
  return {
    ahora: o.ahora ?? Date.now,
    dormir: o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    venceEn: o.venceEn,
  };
}

export type Llamada =
  | { ok: true; r: RespuestaHttp }
  /** `falla` ausente = se acabó el presupuesto de la corrida: NO es culpa del proveedor y no activa backoff. */
  | { ok: false; motivo: string; falla?: FallaLectura; backlog?: boolean };

/**
 * UNA petición con la política común: 5xx con backoff exponencial (3), 429 con
 * `Retry-After` (3), y NUNCA dormir más allá del presupuesto de la corrida.
 * 401/403 NO se reintentan: se devuelven al lector, que sabe qué significan en
 * su API. Una excepción de red es falla de proveedor, no de credencial.
 */
export async function llamar(http: Http, p: PeticionHttp, nombre: string, reloj: Reloj): Promise<Llamada> {
  let r5 = 0;
  let r429 = 0;
  for (;;) {
    if (reloj.venceEn !== undefined && reloj.ahora() >= reloj.venceEn) {
      return { ok: false, motivo: `${nombre} quedó con trabajo pendiente al vencer el presupuesto.`, backlog: true };
    }
    let r: RespuestaHttp;
    try {
      r = await http(p);
    } catch (e) {
      return { ok: false, motivo: `no se pudo llamar a ${nombre}: ${e instanceof Error ? e.message : String(e)}`, falla: 'proveedor' };
    }
    if (r.estado >= 500 && r.estado <= 599) {
      if (r5 >= MAX_REINTENTOS_5XX) {
        return { ok: false, motivo: `${nombre} mantuvo ${r.estado} después de ${MAX_REINTENTOS_5XX} reintentos.`, falla: 'proveedor', backlog: true };
      }
      const espera = Math.min(1_000 * 2 ** r5, 8_000);
      if (reloj.venceEn !== undefined && reloj.ahora() + espera >= reloj.venceEn) {
        return { ok: false, motivo: `${nombre} siguió en 5xx más allá del presupuesto disponible.`, falla: 'proveedor', backlog: true };
      }
      r5 += 1;
      await reloj.dormir(espera);
      continue;
    }
    if (r.estado === 429) {
      if (r429 >= MAX_REINTENTOS_429) {
        return { ok: false, motivo: `${nombre} mantuvo el límite 429 después de ${MAX_REINTENTOS_429} reintentos.`, falla: 'proveedor', backlog: true };
      }
      const espera = retryAfterMs(r.encabezados?.['retry-after'], reloj.ahora());
      if (reloj.venceEn !== undefined && reloj.ahora() + espera >= reloj.venceEn) {
        return { ok: false, motivo: `${nombre} pidió Retry-After más allá del presupuesto disponible.`, falla: 'proveedor', backlog: true };
      }
      r429 += 1;
      await reloj.dormir(espera);
      continue;
    }
    return { ok: true, r };
  }
}

export function jsonObjeto(cuerpo: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(cuerpo);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function jsonCualquiera(cuerpo: string): unknown {
  try { return JSON.parse(cuerpo); } catch { return undefined; }
}

export const aNumero = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** Redondea a 0.1: la precisión que un GPS civil sostiene. */
export const redondear1 = (n: number): number => Math.round(n * 10) / 10;

/** Epoch en segundos → ISO UTC. `null` si no es un instante sano. */
export function isoDeEpoch(valor: unknown, unidad: 's' | 'ms'): string | null {
  const n = aNumero(valor);
  if (n === null || n <= 0) return null;
  const ms = unidad === 's' ? n * 1_000 : n;
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Normaliza una fecha ISO con zona. Una fecha SIN zona es ambigua y se rechaza. */
export function isoConZona(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const t = valor.trim();
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(t)) return null;
  const d = Date.parse(t);
  return Number.isFinite(d) ? new Date(d).toISOString() : null;
}

export type { Http };
