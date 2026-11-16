// Periodos del Back-office: el MES DE MÉXICO, no el de UTC (lección DAT-23: el 31 de diciembre a las 18:01 en México ya es 1 de enero en
// UTC, y «cerrar el mes» cerraba el equivocado). Un periodo es el primer día de su mes como `AAAA-MM-01`. Todo es PURO: la zona sale de
// `@/lib/formato` (`hoyMx`, `inicioDiaMx`), nunca de `getUTCMonth()`.
import { hoyMx, inicioDiaMx, LOCALE_FORMATO, type IdiomaFormato } from '@/lib/formato';

const RE_PERIODO = /^(\d{4})-(0[1-9]|1[0-2])-01$/;
const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ¿Es un periodo válido (`AAAA-MM-01`)? */
export function esPeriodo(valor: unknown): valor is string {
  return typeof valor === 'string' && RE_PERIODO.test(valor);
}

/** El periodo (primer día del mes) en que cae un instante, medido en México. Sin argumento, el mes en curso. */
export function mesDeMx(fecha: Date = new Date()): string {
  return `${hoyMx(fecha).slice(0, 7)}-01`;
}

/** Suma `n` meses (negativo = hacia atrás) a un periodo. Aritmética de calendario sobre año y mes ya resueltos. */
export function desplazarMes(periodo: string, n: number): string {
  const m = RE_PERIODO.exec(periodo);
  if (!m) throw new Error(`periodo inválido: ${periodo}`);
  const indice = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  const anio = Math.floor(indice / 12);
  const mes = (indice % 12 + 12) % 12 + 1;
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-01`;
}

/** Los `n` meses que terminan en `periodo` (inclusive), del más viejo al más reciente. */
export function ultimosMeses(periodo: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => desplazarMes(periodo, i - (n - 1)));
}

export interface RangoMes {
  /** Primer día del mes (`AAAA-MM-01`). */
  ini: string;
  /** Primer día del mes SIGUIENTE (límite exclusivo). */
  finExclusivo: string;
  /** Último día del mes (`AAAA-MM-DD`). */
  ultimoDia: string;
  /** Medianoche de México del primer día, como instante ISO con offset (para `gte`). */
  desdeIso: string;
  /** Medianoche de México del primer día del mes siguiente (para `lt`). */
  hastaIso: string;
}

/** Los límites del mes de un periodo, en fecha y en instante de México. */
export function rangoMes(periodo: string): RangoMes {
  const siguiente = desplazarMes(periodo, 1);
  const [a, m] = siguiente.split('-').map(Number);
  // Día 0 del mes siguiente = último del actual (aritmética UTC sobre año y mes ya resueltos).
  const ultimo = new Date(Date.UTC(a, m - 1, 0)).getUTCDate();
  return {
    ini: periodo,
    finExclusivo: siguiente,
    ultimoDia: `${periodo.slice(0, 8)}${String(ultimo).padStart(2, '0')}`,
    desdeIso: inicioDiaMx(periodo),
    hastaIso: inicioDiaMx(siguiente),
  };
}

/** ¿Este instante ISO cae en el mes (de México) de `periodo`? Un valor ausente o ilegible es `false`, nunca «sí». */
export function instanteEnPeriodo(iso: string | null | undefined, periodo: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return mesDeMx(d) === periodo;
}

/** El día de México (`AAAA-MM-DD`) de un instante ISO, o `null` si no se puede leer. */
export function diaMxDeInstante(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : hoyMx(d);
}

function aUtc(dia: string): number | null {
  const m = RE_DIA.exec(dia);
  if (!m) return null;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, mes - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null;
  return f.getTime();
}

/**
 * Días HÁBILES (lunes a viernes) que pasan después de `desde` hasta `hasta`, ambos `AAAA-MM-DD`: `desde` no cuenta y `hasta` sí.
 * No modela días festivos (no hay calendario de inhábiles en el repo): el resultado es un MÁXIMO honesto, y la pantalla lo rotula así.
 * Fechas ilegibles → `null`; `hasta` anterior o igual a `desde` → 0.
 */
export function diasHabilesEntre(desde: string, hasta: string): number | null {
  const a = aUtc(desde);
  const b = aUtc(hasta);
  if (a === null || b === null) return null;
  let n = 0;
  for (let t = a + 86_400_000; t <= b; t += 86_400_000) {
    const dia = new Date(t).getUTCDay();
    if (dia !== 0 && dia !== 6) n += 1;
  }
  return n;
}

/** Días de calendario de `desde` a `hasta` (ambos `AAAA-MM-DD`; negativo si `hasta` es anterior). Fecha ilegible → `null`, nunca 0. */
export function diasCalendarioEntre(desde: string, hasta: string): number | null {
  const a = aUtc(desde);
  const b = aUtc(hasta);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

/** El nombre del mes en el idioma de la interfaz («octubre de 2026» / «October 2026»). Solo para rotular. */
export function etiquetaMes(periodo: string, idioma: IdiomaFormato = 'es'): string {
  const m = RE_PERIODO.exec(periodo);
  if (!m) return periodo;
  const f = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return new Intl.DateTimeFormat(LOCALE_FORMATO[idioma], { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(f);
}

/** Etiqueta corta de eje («oct 26» / «Oct 26»). */
export function etiquetaMesCorta(periodo: string, idioma: IdiomaFormato = 'es'): string {
  const m = RE_PERIODO.exec(periodo);
  if (!m) return periodo;
  const f = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return new Intl.DateTimeFormat(LOCALE_FORMATO[idioma], { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(f);
}
