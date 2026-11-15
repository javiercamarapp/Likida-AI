// Fechas de la vigilancia: todo se razona en HORA DE MÉXICO (America/Mexico_City). El cron corre a las 13:30 UTC
// (7:30 CDMX), pero un reintento manual a las 23:00 CDMX ya es «mañana» en UTC: usar `toISOString()` barrería un día
// de más o de menos. Formato interno `AAAA-MM-DD`; formato del SIDOF `DD-MM-AAAA`.

import { hoyMx } from '@/lib/formato';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// El día calendario de `ahora` en la Ciudad de México (`AAAA-MM-DD`) es `hoyMx` de `lib/formato.ts`: la única que lo calcula
// (formato.test.ts prohíbe copias a mano). Se re-exporta para que los módulos de la vigilancia importen de un solo sitio.
export { hoyMx };

export function esIso(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false;
  const m = ISO_RE.exec(valor);
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).toISOString().slice(0, 10) === valor;
}

/** Suma (o resta) días a un `AAAA-MM-DD` sin tocar zonas horarias. */
export function sumarDias(iso: string, dias: number): string {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`fecha ISO inválida: ${iso}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + dias * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado. */
export function diaDeSemana(iso: string): number {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`fecha ISO inválida: ${iso}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

export const esDiaHabil = (iso: string): boolean => { const d = diaDeSemana(iso); return d >= 1 && d <= 5; };

/** `AAAA-MM-DD` → `DD-MM-AAAA` (el formato del SIDOF). */
export function aFormatoSidof(iso: string): string {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`fecha ISO inválida: ${iso}`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Cuántos días hay de `desde` (exclusive) a `hasta` (inclusive); 0 si `hasta` no es posterior. */
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}
