// Horario de atención: cuenta solo los minutos de espera que caen dentro del horario. Puro, sin red ni reloj propio.
import type { HorarioAtencion } from './tipos';

const MIN_DIA = 1440;
/** Tope de días recorridos (un hilo más viejo que esto se mide como si empezara hace un año). */
export const MAX_DIAS_HORARIO = 366;

const SEMANA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateador(zona: string): Intl.DateTimeFormat {
  let f = formateadores.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    formateadores.set(zona, f);
  }
  return f;
}

interface Local { fecha: string; minutoDelDia: number; diaSemana: number }

function local(ms: number, zona: string): Local {
  const partes = formateador(zona).formatToParts(new Date(ms));
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? '';
  return { fecha: `${p('year')}-${p('month')}-${p('day')}`, minutoDelDia: (Number(p('hour')) % 24) * 60 + Number(p('minute')), diaSemana: SEMANA[p('weekday')] ?? 0 };
}

/**
 * Minutos enteros entre `desdeMs` y `hastaMs` que caen dentro del horario de atención (hora local de `zona`).
 * No cuentan los días no hábiles (`diasHabiles`, 0 = domingo) ni los `festivos` ('YYYY-MM-DD'). Recorre día por día.
 */
export function minutosEnHorario(desdeMs: number, hastaMs: number, horario: HorarioAtencion, zona: string, festivos: readonly string[]): number {
  if (!(hastaMs > desdeMs)) return 0;
  const inicio = Math.max(desdeMs, hastaMs - MAX_DIAS_HORARIO * MIN_DIA * 60_000);
  const habiles = horario.diasHabiles ? new Set(horario.diasHabiles) : null;
  const feriados = new Set(festivos);
  const aperturaMin = horario.desdeHora * 60;
  const cierreMin = horario.hastaHora * 60;
  let total = 0;
  let t = inicio;
  for (let guardia = 0; t < hastaMs && guardia <= MAX_DIAS_HORARIO + 2; guardia += 1) {
    const l = local(t, zona);
    const finDiaMs = t + (MIN_DIA - l.minutoDelDia) * 60_000;
    const tramoFin = Math.min(finDiaMs, hastaMs);
    if ((!habiles || habiles.has(l.diaSemana)) && !feriados.has(l.fecha)) {
      const a = l.minutoDelDia;
      const b = l.minutoDelDia + (tramoFin - t) / 60_000;
      total += Math.max(0, Math.min(b, cierreMin) - Math.max(a, aperturaMin));
    }
    t = tramoFin;
  }
  return Math.floor(total);
}
