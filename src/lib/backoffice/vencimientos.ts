// Vigía de vencimientos de LIKIDA MISMA (contratos, suscripciones, dominios, créditos). PURO: sin base, sin reloj (la fecha de hoy entra por parámetro).
// Reutiliza `clasificarVigencia` y `DIAS_AVISO` de `likida/vigencias.ts` (el patrón de los papeles de la flota) sin modificarlos; lo que añade es la
// ventana POR TIPO del prompt `vigia-de-vencimientos.md` y los hallazgos (sin fecha, sin responsable). Los avisos solo se MUESTRAN: no hay envío saliente.
import { clasificarVigencia, DIAS_AVISO, type EstadoVigencia } from '@/lib/likida/vigencias';

export type TipoContrato = 'cliente' | 'proveedor' | 'suscripcion' | 'dominio' | 'creditos' | 'legal_pendiente' | 'vendedor' | 'otro';
export const TIPOS_CONTRATO: readonly TipoContrato[] = ['cliente', 'proveedor', 'suscripcion', 'dominio', 'creditos', 'legal_pendiente', 'vendedor', 'otro'];

/** Estado GUARDADO (el que escribe el código). `por_renovar` y `vencido` existen en la base pero se calculan con la fecha de hoy. */
export type EstadoContrato = 'borrador' | 'vigente' | 'por_renovar' | 'vencido' | 'terminado';

/**
 * Ventanas de aviso fijas por tipo (días antes), del prompt del vigía; no se cambian sin que Javier lo pida.
 *   cliente 60 y 30 · suscripción 15 · dominio 30 · documento legal con fecha límite 10 y 3.
 * Los demás tipos (proveedor, créditos, vendedor, otro) no tienen ventana fija: rige `diasAviso` de la propia fila (por omisión `DIAS_AVISO`).
 * Los créditos con expiración se avisan por % restante del paquete en el prompt; sin saldo medido no se puede evaluar ese %, y aquí solo se vigila la fecha.
 */
export const VENTANAS_POR_TIPO: Readonly<Partial<Record<TipoContrato, readonly number[]>>> = {
  cliente: [60, 30],
  suscripcion: [15],
  dominio: [30],
  legal_pendiente: [10, 3],
};

/** Menos de este número de días es «urgente» (el prompt: «[URGENTE, <10 días]»). */
export const DIAS_URGENTE = 10;

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Milisegundos UTC de una fecha `YYYY-MM-DD` real, o null si no es una fecha válida. */
function diaUtc(f: string | null | undefined): number | null {
  if (!f) return null;
  const m = FECHA.exec(f);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const chk = new Date(ms);
  return chk.getUTCFullYear() === y && chk.getUTCMonth() === mo - 1 && chk.getUTCDate() === d ? ms : null;
}

/** Días de calendario de `hoy` a `venceEl` (negativos si ya venció). null si no hay fecha o alguna no es válida. `hoy` = `hoyMx()`. */
export function diasAlVencimiento(venceEl: string | null | undefined, hoy: string): number | null {
  const v = diaUtc(venceEl);
  const h = diaUtc(hoy);
  if (v === null || h === null) return null;
  return Math.round((v - h) / 86_400_000);
}

export type EstadoVencimiento = EstadoVigencia | 'no_vence' | 'inactivo';
export type NivelVencimiento = 'vencido' | 'urgente' | 'proximo' | 'fuera' | 'sin_fecha' | 'no_vence' | 'inactivo';
export type HallazgoVencimiento = 'sin_fecha' | 'sin_responsable';

export interface EntradaVencimiento {
  tipo: TipoContrato;
  estado: EstadoContrato;
  venceEl: string | null;
  diasAviso?: readonly number[] | null;
  responsable?: string | null;
}

export interface Vencimiento {
  estado: EstadoVencimiento;
  nivel: NivelVencimiento;
  /** Días al vencimiento (negativos = vencido). null si no hay fecha. */
  dias: number | null;
  dentroDeVentana: boolean;
  /** Los umbrales (días antes) que rigen esta fila, de mayor a menor. */
  ventana: readonly number[];
  /** El umbral más cercano ya cruzado (p. ej. con ventana 60/30 y 45 días, 60); null si no hay ninguno cruzado. */
  avisoActual: number | null;
  /** Créditos sin fecha: «No vence». No es un hueco de datos. */
  noVence: boolean;
  /** Rótulo en español de `clasificarVigencia` (la pantalla usa su propio diccionario; esto es para bitácora y pruebas). */
  rotulo: string;
  hallazgos: readonly HallazgoVencimiento[];
}

/** La ventana efectiva de una fila: la fija de su tipo, o la propia (`diasAviso`), o `DIAS_AVISO`. Siempre de mayor a menor y sin repetidos. */
export function ventanaDe(tipo: TipoContrato, diasAviso?: readonly number[] | null): readonly number[] {
  const fija = VENTANAS_POR_TIPO[tipo];
  const base = fija ?? (diasAviso && diasAviso.length > 0 ? diasAviso : [DIAS_AVISO]);
  return [...new Set(base.filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => b - a);
}

/** ¿Un contrato terminado o en borrador se vigila? No: un borrador no obliga a nadie y un terminado ya no vence. */
const vigilado = (estado: EstadoContrato): boolean => estado !== 'terminado' && estado !== 'borrador';

/**
 * Qué le pasa a UNA fila con el tiempo. Reglas:
 *   · terminado o borrador → `inactivo`: no avisa ni cuenta como vivo;
 *   · sin fecha → `sin_dato` («Sin fecha declarada»), NUNCA `vigente`; los créditos sin fecha son `no_vence`;
 *   · vencido (días < 0) → `vencido`; dentro de la ventana de su tipo (0 ≤ días ≤ umbral mayor) → `por_vencer`; fuera → `vigente`;
 *   · hallazgos: sin fecha declarada y sin responsable (un vencimiento sin dueño es el que de verdad se pasa).
 */
export function evaluarVencimiento(e: EntradaVencimiento, hoy: string): Vencimiento {
  const ventana = ventanaDe(e.tipo, e.diasAviso);
  const dias = diasAlVencimiento(e.venceEl, hoy);
  const base = clasificarVigencia(dias, null);
  if (!vigilado(e.estado)) {
    return { estado: 'inactivo', nivel: 'inactivo', dias, dentroDeVentana: false, ventana, avisoActual: null, noVence: false, rotulo: base.rotulo, hallazgos: [] };
  }
  const hallazgos: HallazgoVencimiento[] = [];
  const sinResponsable = !e.responsable || e.responsable.trim() === '';
  const noVence = e.tipo === 'creditos' && dias === null;
  if (dias === null && !noVence) hallazgos.push('sin_fecha');
  if (sinResponsable) hallazgos.push('sin_responsable');

  if (dias === null) {
    return noVence
      ? { estado: 'no_vence', nivel: 'no_vence', dias, dentroDeVentana: false, ventana, avisoActual: null, noVence, rotulo: base.rotulo, hallazgos }
      : { estado: 'sin_dato', nivel: 'sin_fecha', dias, dentroDeVentana: false, ventana, avisoActual: null, noVence, rotulo: base.rotulo, hallazgos };
  }
  if (dias < 0) {
    return { estado: 'vencido', nivel: 'vencido', dias, dentroDeVentana: false, ventana, avisoActual: null, noVence, rotulo: base.rotulo, hallazgos };
  }
  const cruzados = ventana.filter((u) => dias <= u);
  const dentroDeVentana = cruzados.length > 0;
  const avisoActual = dentroDeVentana ? Math.min(...cruzados) : null;
  return {
    estado: dentroDeVentana ? 'por_vencer' : 'vigente',
    nivel: !dentroDeVentana ? 'fuera' : dias < DIAS_URGENTE ? 'urgente' : 'proximo',
    dias, dentroDeVentana, ventana, avisoActual, noVence, rotulo: base.rotulo, hallazgos,
  };
}

/** Menos días primero (los vencidos, que son negativos, encabezan); sin fecha (null) al final. Estable. No muta la entrada. */
export function ordenarPorUrgencia<T>(items: readonly T[], diasDe: (x: T) => number | null): T[] {
  return items
    .map((x, i) => ({ x, i, d: diasDe(x) }))
    .sort((a, b) => (a.d === null ? 1 : 0) - (b.d === null ? 1 : 0) || (a.d ?? 0) - (b.d ?? 0) || a.i - b.i)
    .map((r) => r.x);
}

export interface ResumenVencimientos {
  /** Vigilados: ni borrador ni terminado. */
  vivos: number;
  vencenEnVentana: number;
  vencidos: number;
  /** Sin fecha declarada (no cuenta créditos que no vencen). */
  sinFecha: number;
  sinResponsable: number;
  /** Contratos de cliente vivos: 0 es un estado real («0 clientes con contrato vivo»), no un hueco. */
  clientesVivos: number;
  noVencen: number;
}

export function resumenVencimientos(filas: ReadonlyArray<{ tipo: TipoContrato; ev: Vencimiento }>): ResumenVencimientos {
  const r: ResumenVencimientos = { vivos: 0, vencenEnVentana: 0, vencidos: 0, sinFecha: 0, sinResponsable: 0, clientesVivos: 0, noVencen: 0 };
  for (const { tipo, ev } of filas) {
    if (ev.estado === 'inactivo') continue;
    r.vivos++;
    if (tipo === 'cliente') r.clientesVivos++;
    if (ev.dentroDeVentana) r.vencenEnVentana++;
    if (ev.estado === 'vencido') r.vencidos++;
    if (ev.hallazgos.includes('sin_fecha')) r.sinFecha++;
    if (ev.hallazgos.includes('sin_responsable')) r.sinResponsable++;
    if (ev.noVence) r.noVencen++;
  }
  return r;
}

/** Los próximos `n` meses (el actual primero) con cuántos vigilados vencen en cada uno. Los ya vencidos no entran (van en su propia cifra). */
export function vencimientosPorMes(
  filas: ReadonlyArray<{ venceEl: string | null; ev: Vencimiento }>,
  hoy: string,
  n = 12,
): Array<{ mes: string; n: number }> {
  const m = FECHA.exec(hoy);
  if (!m) return [];
  const y0 = Number(m[1]);
  const mo0 = Number(m[2]) - 1;
  const meses: Array<{ mes: string; n: number }> = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(y0, mo0 + i, 1));
    meses.push({ mes: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, n: 0 });
  }
  for (const f of filas) {
    if (f.ev.estado === 'inactivo' || f.ev.dias === null || f.ev.dias < 0 || !f.venceEl) continue;
    const celda = meses.find((x) => x.mes === f.venceEl!.slice(0, 7));
    if (celda) celda.n++;
  }
  return meses;
}
