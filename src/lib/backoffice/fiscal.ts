import type { Lectura } from './lectura';

// Calendario fiscal de Likida: tipos, fechas NOMINALES y candado de entidad. PURO. Sin red y sin SAT: nada aquí consulta, presenta ni
// declara. «Presentada» la marca una persona con acuse. Las fechas son generales (propuesta sembrada, `pendiente_de_contador`) y NO se
// ajustan por día inhábil: se marca `sujetaADiaInhabil` cuando caen en fin de semana, y los feriados no se calculan.

export type Periodicidad = 'mensual' | 'anual' | 'evento';
export type EstadoCatalogo = 'pendiente_de_contador' | 'revisada_por_contador';

export interface ObligacionFiscal {
  clave: string;
  nombre: string;
  periodicidad: Periodicidad;
  /** Día del mes de la fecha límite (null en las de evento). */
  diaLimite: number | null;
  /** Solo anuales: mes (1-12) de la fecha límite. */
  mesLimite: number | null;
  /** Meses después del periodo en que cae la fecha límite (mensuales: 1 = el mes siguiente). */
  mesesDesfase: number;
  requiereEntidad: boolean;
  estadoCatalogo: EstadoCatalogo;
  nota?: string | null;
}

export type EstadoCumplimiento = 'pendiente' | 'paquete_listo' | 'presentada' | 'no_aplica';

export interface Cumplimiento {
  clave: string;
  /** Primer día del mes que cubre (las anuales: 1 de enero del ejercicio). */
  periodo: string;
  estado: EstadoCumplimiento;
  paqueteGeneradoEn: string | null;
  presentadaPor: string | null;
  presentadaEn: string | null;
  acuseRef: string | null;
  nota: string | null;
}

/** Lo que el calendario muestra de una obligación: `aun_no_aplica` (sin entidad) y `sin_fecha` (evento) se suman a los estados guardados. */
export type EstadoObligacion = 'aun_no_aplica' | 'sin_fecha' | EstadoCumplimiento;

// ───────────────────────── Candado de entidad ─────────────────────────

export interface EntidadLegal {
  rfc: string | null;
  razonSocial?: string | null;
  constituidaEl?: string | null;
}

export type Candado =
  | { bloqueado: false; rfc: string }
  | { bloqueado: true; motivo: 'sin_rfc' | 'entidad_no_disponible' | 'entidad_no_leida' };

/**
 * Likida aún no tiene razón social ni RFC propios (SAPI sin constituir). Mientras no haya RFC, ni el paquete contable, ni la DIOT, ni los
 * CFDI de gastos, ni «deducible en forma» son evaluables. Una entidad ilegible (tabla ausente o error) también bloquea: no se supone un RFC.
 */
export function candadoDeEntidad(entidad: Lectura<EntidadLegal | null>): Candado {
  if (entidad.estado === 'no_disponible') return { bloqueado: true, motivo: 'entidad_no_disponible' };
  if (entidad.estado === 'error') return { bloqueado: true, motivo: 'entidad_no_leida' };
  const rfc = entidad.dato?.rfc?.trim() ?? '';
  if (!rfc) return { bloqueado: true, motivo: 'sin_rfc' };
  return { bloqueado: false, rfc };
}

// ───────────────────────── Fechas ISO (sin zona horaria) ─────────────────────────

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function esFechaIso(s: string): boolean {
  const m = ISO.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function partesIso(s: string): { y: number; m: number; d: number } {
  const m = ISO.exec(s);
  if (!m) throw new Error(`fecha ISO invalida: ${s}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function fechaIso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function ultimoDiaDelMes(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Primer día del mes `k` meses después (k puede ser negativo) del mes de `periodo` (aaaa-mm-dd). */
export function sumarMeses(periodo: string, k: number): string {
  const { y, m } = partesIso(periodo);
  const total = y * 12 + (m - 1) + k;
  return fechaIso(Math.floor(total / 12), (total % 12 + 12) % 12 + 1, 1);
}

/** Primer día del mes de una fecha. */
export function primerDiaDelMes(fecha: string): string {
  const { y, m } = partesIso(fecha);
  return fechaIso(y, m, 1);
}

/** Días de `a` a `b` (positivo si `b` es posterior). */
export function diasEntre(a: string, b: string): number {
  const pa = partesIso(a);
  const pb = partesIso(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** 0 = domingo … 6 = sábado. */
export function diaDeLaSemana(fecha: string): number {
  const { y, m, d } = partesIso(fecha);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// ───────────────────────── Fecha límite nominal ─────────────────────────

/** Fecha límite NOMINAL de una obligación para un periodo, o null si no tiene (eventos). No se ajusta por día inhábil. */
export function fechaLimiteNominal(ob: ObligacionFiscal, periodo: string): string | null {
  if (ob.periodicidad === 'evento' || ob.diaLimite === null) return null;
  const { y, m } = partesIso(periodo);
  if (ob.periodicidad === 'anual') {
    if (ob.mesLimite === null) return null;
    const anio = y + 1 + ob.mesesDesfase;
    return fechaIso(anio, ob.mesLimite, Math.min(ob.diaLimite, ultimoDiaDelMes(anio, ob.mesLimite)));
  }
  const destino = sumarMeses(fechaIso(y, m, 1), ob.mesesDesfase);
  const p = partesIso(destino);
  return fechaIso(p.y, p.m, Math.min(ob.diaLimite, ultimoDiaDelMes(p.y, p.m)));
}

export interface ProximaFecha {
  /** La fecha límite nominal más próxima a `hoy` (o de hoy en adelante); null si la obligación no tiene fecha. */
  fecha: string | null;
  /** El periodo que esa fecha cubre. */
  periodo: string | null;
  /** true si la fecha nominal cae en fin de semana: puede correrse al siguiente día hábil, y eso lo decide el contador, no este código. */
  sujetaADiaInhabil: boolean;
  /** Siempre true: la fecha es nominal, jamás ajustada. */
  nominal: true;
}

/** Candidatos de periodo de una obligación alrededor de `hoy`, del más viejo al más nuevo. */
export function periodosCandidatos(ob: ObligacionFiscal, hoy: string): string[] {
  if (ob.periodicidad === 'evento') return [];
  const { y } = partesIso(hoy);
  if (ob.periodicidad === 'anual') return [fechaIso(y - 1, 1, 1), fechaIso(y, 1, 1), fechaIso(y + 1, 1, 1)];
  const base = sumarMeses(primerDiaDelMes(hoy), -ob.mesesDesfase);
  return [-1, 0, 1, 2].map((k) => sumarMeses(base, k));
}

/** La próxima fecha límite NOMINAL de `hoy` en adelante (ignora si ya se cumplió: eso es del calendario). */
export function proximaFecha(ob: ObligacionFiscal, hoy: string): ProximaFecha {
  for (const periodo of periodosCandidatos(ob, hoy)) {
    const fecha = fechaLimiteNominal(ob, periodo);
    if (fecha !== null && diasEntre(hoy, fecha) >= 0) {
      const dia = diaDeLaSemana(fecha);
      return { fecha, periodo, sujetaADiaInhabil: dia === 0 || dia === 6, nominal: true };
    }
  }
  return { fecha: null, periodo: null, sujetaADiaInhabil: false, nominal: true };
}

/** Estado que se muestra de una obligación. Sin entidad (RFC), lo que requiere entidad «aún no aplica» y no lleva fecha. */
export function estadoObligacion(ob: ObligacionFiscal, candado: Candado, cumplimiento: Cumplimiento | null): EstadoObligacion {
  if (ob.requiereEntidad && candado.bloqueado) return 'aun_no_aplica';
  if (ob.periodicidad === 'evento') return 'sin_fecha';
  return cumplimiento?.estado ?? 'pendiente';
}

/** ¿Este cumplimiento ya cerró su periodo? (presentada o declarada «no aplica»). */
export function estaCerrado(c: Cumplimiento | null | undefined): boolean {
  return !!c && (c.estado === 'presentada' || c.estado === 'no_aplica');
}
