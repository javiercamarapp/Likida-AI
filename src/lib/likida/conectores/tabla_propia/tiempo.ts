import { TZ_MX } from '@/lib/formato';

// ── Hora local sin zona ⇄ UTC, con la zona configurable por flota ───────────
// El nombre de la zona por omisión vive solo en `formato.ts` (hay una guardia que lo exige).
export const ZONA_POR_OMISION = TZ_MX;

const FECHA_LOCAL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const FECHA_DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const CON_ZONA = /(Z|[+-]\d{2}(?::?\d{2})?)$/i;

/** ¿Es un nombre de zona IANA que este runtime conoce? */
export function zonaValida(zona: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zona }); return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(zona); } catch { return false; }
}

const p2 = (n: number) => String(n).padStart(2, '0');

function desfaseMs(instante: number, zona: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instante));
  const g = (t: string) => Number(partes.find((x) => x.type === t)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(instante / 1000) * 1000;
}

/** «2026-10-20 09:00:00» en `zona` → instante UTC (desfase REAL de esa fecha; una segunda pasada cubre el cambio de horario). */
export function localAUtc(fechaHoraLocal: string, zona: string = ZONA_POR_OMISION): Date {
  const r = FECHA_LOCAL.exec(fechaHoraLocal);
  if (!r) throw new Error(`fecha local inválida: ${fechaHoraLocal}`);
  const comoUtc = Date.UTC(+r[1], +r[2] - 1, +r[3], +r[4], +r[5], +(r[6] ?? 0));
  let utc = comoUtc - desfaseMs(comoUtc, zona);
  utc = comoUtc - desfaseMs(utc, zona);
  return new Date(utc);
}

/** Instante UTC → «AAAA-MM-DD HH:MM:SS» en `zona`. */
export function utcALocal(d: Date, zona: string = ZONA_POR_OMISION): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => partes.find((x) => x.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`;
}

/**
 * Normaliza lo que su sistema entrega como fecha a «AAAA-MM-DD HH:MM:SS» LOCAL de `zona`.
 *  · Sin zona (lo habitual): se toma como hora local de la zona configurada.
 *  · Con zona EXPLÍCITA (Z o ±hh:mm): el instante es exacto, se convierte a la hora local de `zona`
 *    (no se supone nada: la zona viene en el dato).
 *  · Formato desconocido o fecha imposible: se rechaza (jamás se adivina; DD/MM/AAAA sí, MM/DD no se voltea).
 */
export function normalizarFechaLocal(v: string, zona: string = ZONA_POR_OMISION): { ok: string } | { error: string } {
  const t = v.trim();
  if (t === '') return { error: 'fecha_hora vacía' };
  if (CON_ZONA.test(t) && /\d{2}:\d{2}/.test(t)) {
    const ms = Date.parse(t.includes(' ') && !t.includes('T') ? t.replace(' ', 'T') : t);
    if (!Number.isFinite(ms)) return { error: 'fecha_hora con zona ilegible' };
    return { ok: utcALocal(new Date(ms), zona) };
  }
  let a: number, m: number, d: number, h: number, mi: number, s: number;
  let r = FECHA_LOCAL.exec(t);
  if (r) { [a, m, d, h, mi, s] = [+r[1], +r[2], +r[3], +r[4], +r[5], +(r[6] ?? 0)]; }
  else {
    r = FECHA_DMY.exec(t);
    if (!r) return { error: 'fecha_hora con formato desconocido (esperaba AAAA-MM-DD HH:MM:SS o DD/MM/AAAA HH:MM)' };
    [d, m, a, h, mi, s] = [+r[1], +r[2], +r[3], +r[4], +r[5], +(r[6] ?? 0)];
  }
  const f = new Date(Date.UTC(a, m - 1, d, h, mi, s));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return { error: 'fecha_hora inexistente' };
  return { ok: `${a}-${p2(m)}-${p2(d)} ${p2(h)}:${p2(mi)}:${p2(s)}` };
}
