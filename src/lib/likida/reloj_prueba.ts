/**
 * Reloj simulado para pruebas de zona horaria (T-SYS-08).
 *
 * `conReloj('2026-10-20T09:00', 'America/Mexico_City', fn)` fija `Date`/`Date.now()`
 * al instante UTC que corresponde a esa hora de pared en esa zona y restaura el
 * reloj real al terminar (también si `fn` lanza o devuelve una promesa rechazada).
 *
 * Solo para pruebas: importa `vitest`. No lo importes desde código de producción.
 */
import { TZ_MX } from '@/lib/formato';
import { vi } from 'vitest';

export const ZONA_CDMX = TZ_MX;
/** Quintana Roo: UTC−5 todo el año (sin horario de verano). */
export const ZONA_CANCUN = 'America/Cancun';
/** Nuevo Laredo / Matamoros: siguen el horario de verano de EE. UU. (tzdata las agrupa). */
export const ZONA_FRONTERA = 'America/Matamoros';

// eslint-disable-next-line security/detect-unsafe-regex -- patrón anclado de formato fijo, sin cuantificadores anidados ni retroceso exponencial; la entrada es un valor corto de una celda o campo
const PATRON_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function partesEnZona(instanteMs: number, zona: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(instanteMs))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** Desfase de la zona (ms, positivo al este de UTC) en un instante dado. */
export function desfaseZonaMs(instanteMs: number, zona: string): number {
  return partesEnZona(instanteMs, zona) - Math.floor(instanteMs / 1000) * 1000;
}

/**
 * Convierte una hora de pared `AAAA-MM-DDTHH:mm[:ss]` en `zona` al instante UTC (ms).
 * Lanza si la fecha no existe (29-feb de año no bisiesto, mes 13…) o si esa hora no
 * existe en la zona (salto de horario de verano).
 */
export function instanteDeLocal(isoLocal: string, zona: string): number {
  const m = PATRON_LOCAL.exec(isoLocal);
  if (!m) throw new Error(`reloj_prueba: formato inválido «${isoLocal}» (se espera AAAA-MM-DDTHH:mm)`);
  const [a, mes, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number);
  const nominal = Date.UTC(a, mes - 1, d, h, mi, s);
  const n = new Date(nominal);
  if (n.getUTCFullYear() !== a || n.getUTCMonth() !== mes - 1 || n.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) {
    throw new Error(`reloj_prueba: la fecha «${isoLocal}» no existe`);
  }
  // Dos pasadas bastan para converger incluso cerca de un cambio de horario.
  let instante = nominal - desfaseZonaMs(nominal, zona);
  instante = nominal - desfaseZonaMs(instante, zona);
  if (partesEnZona(instante, zona) !== nominal) {
    throw new Error(`reloj_prueba: «${isoLocal}» no existe en ${zona} (salto de horario)`);
  }
  return instante;
}

/** Ejecuta `fn` con el reloj fijo en la hora de pared indicada y lo restaura siempre. */
export async function conReloj<T>(isoLocal: string, zona: string, fn: () => T | Promise<T>): Promise<T> {
  const instante = instanteDeLocal(isoLocal, zona);
  vi.useFakeTimers({ now: instante, toFake: ['Date'] });
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}
