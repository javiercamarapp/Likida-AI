import type { FilaMapaCalor } from '@/app/ui-v2/graficas';

/** Bloques de 3 horas: la etiqueta es la hora en que empieza («00», «03»… «21»). 24 columnas no caben en un teléfono. */
export const BLOQUES_HORA = ['00', '03', '06', '09', '12', '15', '18', '21'] as const;

const SEMANA: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

const PARTES = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', weekday: 'short', hour: '2-digit', hourCycle: 'h23' });

/** Día de la semana (lunes = 0) y hora (0-23) de un instante en hora de México; `null` si la fecha no se puede leer. */
export function diaYHoraMx(iso: string): { dia: number; hora: number } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const p = PARTES.formatToParts(new Date(ms));
  const dia = SEMANA[p.find((x) => x.type === 'weekday')?.value ?? ''];
  const hora = Number(p.find((x) => x.type === 'hour')?.value);
  return dia === undefined || !Number.isFinite(hora) ? null : { dia, hora };
}

/**
 * Matriz día de la semana × bloque de 3 horas con el número de corridas que EMPEZARON ahí. Una celda sin corridas vale 0 (es un conteo
 * real de las filas dadas, no una lectura que pudo fallar); una fecha ilegible no se cuenta y se devuelve en `ilegibles`.
 */
export function matrizDeCorridas(inicios: readonly string[], dias: readonly string[]): { filas: FilaMapaCalor[]; contadas: number; ilegibles: number } {
  const m = dias.map(() => BLOQUES_HORA.map(() => 0));
  let contadas = 0;
  let ilegibles = 0;
  for (const iso of inicios) {
    const x = diaYHoraMx(iso);
    if (x === null) { ilegibles++; continue; }
    m[x.dia][Math.floor(x.hora / 3)]++;
    contadas++;
  }
  return { filas: dias.map((etiqueta, i) => ({ etiqueta, valores: m[i] })), contadas, ilegibles };
}
