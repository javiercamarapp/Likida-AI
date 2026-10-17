// T-A4-31 · Turnos del Vigía: quién recibe la alerta de noche y en festivos. PURO (sin base, sin reloj propio): el llamador pasa «ahora».
//
// Reglas (migración 0798, `vigia_director.turno`):
//   siempre                   → recibe a toda hora (como hoy).
//   noche                     → solo si la hora LOCAL de la flota cae en la ventana de noche (por omisión 20:00–07:00).
//   festivos_y_fin_de_semana  → solo si el día LOCAL es festivo (calendario de la flota) o sábado/domingo.
// La zona es IANA (`tenant.zona_horaria`); no se supone ningún horario de verano: se pregunta a Intl por la hora local en esa zona.
// Garantía de cobertura: `filtrarPorTurno` NUNCA deja un nivel sin destinatario; si el filtro lo vacía, devuelve a todos.

import { TZ_MX } from '@/lib/formato';

export type TurnoDirector = 'siempre' | 'noche' | 'festivos_y_fin_de_semana';
export type TurnoActual = 'dia' | 'noche' | 'festivo';

export const TURNOS_DIRECTOR: readonly TurnoDirector[] = ['siempre', 'noche', 'festivos_y_fin_de_semana'];
export const ZONA_POR_OMISION = TZ_MX;

export interface VentanaNoche { desdeHora: number; hastaHora: number }
/** Noche por omisión: de las 20:00 a las 07:00 locales (cruza la medianoche). */
export const NOCHE_POR_OMISION: VentanaNoche = { desdeHora: 20, hastaHora: 7 };

export function esTurnoDirector(v: unknown): v is TurnoDirector {
  return typeof v === 'string' && (TURNOS_DIRECTOR as readonly string[]).includes(v);
}
/** Lo que llega de la base o de un formulario: lo desconocido es `siempre` (nunca se queda alguien sin recibir por un valor raro). */
export function aTurnoDirector(v: unknown): TurnoDirector {
  return esTurnoDirector(v) ? v : 'siempre';
}

export interface HoraLocal { fecha: string; hora: number; diaSemana: number }   // fecha 'YYYY-MM-DD'; diaSemana 0 = domingo … 6 = sábado

const SEMANA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** La fecha, la hora y el día de la semana de `ahora` EN la zona IANA dada. Zona inválida → la de omisión (no lanza). */
export function horaLocal(ahora: Date, zona: string): HoraLocal {
  const formatear = (z: string) => new Intl.DateTimeFormat('en-US', {
    timeZone: z, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short',
  }).formatToParts(ahora);
  let partes: Intl.DateTimeFormatPart[];
  try { partes = formatear(zona); } catch { partes = formatear(ZONA_POR_OMISION); }
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? '';
  return {
    fecha: `${p('year')}-${p('month')}-${p('day')}`,
    hora: Number(p('hour')) % 24,
    diaSemana: SEMANA[p('weekday')] ?? 0,
  };
}

function normalizarVentana(v: VentanaNoche): VentanaNoche {
  const h = (n: number, d: number) => (Number.isInteger(n) && n >= 0 && n <= 23 ? n : d);
  return { desdeHora: h(v.desdeHora, NOCHE_POR_OMISION.desdeHora), hastaHora: h(v.hastaHora, NOCHE_POR_OMISION.hastaHora) };
}

/** ¿La hora local cae en la noche? Desde incluido, hasta excluido; si desde > hasta, cruza la medianoche; si son iguales, no hay noche. */
export function esNoche(hora: number, noche: VentanaNoche = NOCHE_POR_OMISION): boolean {
  const { desdeHora, hastaHora } = normalizarVentana(noche);
  if (desdeHora === hastaHora) return false;
  return desdeHora < hastaHora ? hora >= desdeHora && hora < hastaHora : hora >= desdeHora || hora < hastaHora;
}

/** ¿El día local es festivo de la flota o fin de semana? `festivos` son fechas 'YYYY-MM-DD'. */
export function esFestivoOFinDeSemana(local: HoraLocal, festivos: Iterable<string>): boolean {
  if (local.diaSemana === 0 || local.diaSemana === 6) return true;
  for (const f of festivos) if (f === local.fecha) return true;
  return false;
}

/** La clasificación del momento: festivo (día festivo o fin de semana) > noche > día. */
export function turnoActual(ahora: Date, zona: string, festivos: Iterable<string> = [], noche: VentanaNoche = NOCHE_POR_OMISION): TurnoActual {
  const local = horaLocal(ahora, zona);
  if (esFestivoOFinDeSemana(local, festivos)) return 'festivo';
  return esNoche(local.hora, noche) ? 'noche' : 'dia';
}

/**
 * ¿Recibe la alerta quien tiene este turno AHORA? Cada turno se evalúa por su cuenta: de madrugada de sábado reciben a la vez
 * los de `noche` y los de `festivos_y_fin_de_semana` (un turno no tapa al otro).
 */
export function recibeAhora(turno: TurnoDirector, ahora: Date, zona: string, festivos: Iterable<string> = [], noche: VentanaNoche = NOCHE_POR_OMISION): boolean {
  if (turno === 'siempre') return true;
  const local = horaLocal(ahora, zona);
  return turno === 'noche' ? esNoche(local.hora, noche) : esFestivoOFinDeSemana(local, festivos);
}

/**
 * Deja a quienes les toca ahora. Si nadie queda (todos con turno y ninguno en el suyo), devuelve a TODOS: un cliente crítico
 * nunca se queda sin aviso por la sobrescritura de turnos. `filtrada` avisa si hubo recorte (para el registro).
 */
export function filtrarPorTurno<T extends { turno: TurnoDirector }>(
  lista: readonly T[], ahora: Date, zona: string, festivos: Iterable<string> = [], noche: VentanaNoche = NOCHE_POR_OMISION,
): { lista: T[]; cayoATodos: boolean } {
  if (lista.every((d) => d.turno === 'siempre')) return { lista: [...lista], cayoATodos: false };
  const fest = [...festivos];
  const tocan = lista.filter((d) => recibeAhora(d.turno, ahora, zona, fest, noche));
  return tocan.length > 0 ? { lista: tocan, cayoATodos: false } : { lista: [...lista], cayoATodos: lista.length > 0 };
}

// ── Festivos oficiales de México: una SUGERENCIA que la flota edita (no se guarda sola) ──

export interface FestivoSugerido { fecha: string; nombre: string }

const dos = (n: number) => String(n).padStart(2, '0');
/** El n-ésimo lunes de un mes (mes 1–12), como día del mes. */
function nEsimoLunes(anio: number, mes: number, n: number): number {
  const primerDia = new Date(Date.UTC(anio, mes - 1, 1)).getUTCDay();   // 0 domingo … 6 sábado
  const primerLunes = 1 + ((8 - primerDia) % 7);
  return primerLunes + 7 * (n - 1);
}

/** Descansos obligatorios de la Ley Federal del Trabajo (art. 74) para `anio`. El 1 de octubre solo cada seis años (2024, 2030…). */
export function festivosOficialesMx(anio: number): FestivoSugerido[] {
  const f = (mes: number, dia: number, nombre: string): FestivoSugerido => ({ fecha: `${anio}-${dos(mes)}-${dos(dia)}`, nombre });
  const lista = [
    f(1, 1, 'Año Nuevo'),
    f(2, nEsimoLunes(anio, 2, 1), 'Día de la Constitución'),
    f(3, nEsimoLunes(anio, 3, 3), 'Natalicio de Juárez'),
    f(5, 1, 'Día del Trabajo'),
    f(9, 16, 'Día de la Independencia'),
    f(11, nEsimoLunes(anio, 11, 3), 'Día de la Revolución'),
    f(12, 25, 'Navidad'),
  ];
  if (anio >= 2024 && (anio - 2024) % 6 === 0) lista.push(f(10, 1, 'Transmisión del Poder Ejecutivo'));
  return lista.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Valida una fecha 'YYYY-MM-DD' real (rechaza 2026-02-30). */
export function esFechaValida(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
