// Utilidades PURAS compartidas por el LOTE C del Back-office (gastos, comisiones, pagos a vendedores, tesorería).
// Dinero: pesos `numeric(12,2)` en la base; las funciones puras operan en CENTAVOS enteros y se convierte en el borde.
// Mes de MÉXICO, no UTC (lección DAT-23): el día se toma de `hoyMx`.
import { hoyMx, masDeDosDecimales, parsearImporteMx } from '@/lib/formato';

/** Error de validación del Back-office: la CLAVE es una del diccionario `admin_backoffice`; la acción la traduce con SU traductor. */
export class ErrorBo extends Error {
  constructor(readonly clave: string, readonly vars?: Record<string, string | number>) {
    super(clave);
    this.name = 'ErrorBo';
  }
}

/** Atajo para lanzar: `throw errBo('gastos.err_sin_tipo_cambio')`. */
export const errBo = (clave: string, vars?: Record<string, string | number>): ErrorBo => new ErrorBo(clave, vars);

/** Pesos → centavos enteros. El épsilon hace que 1.005 sea 101 y no 100 (el flotante lo guarda como 1.00499…). */
export function centavos(pesosNum: number): number {
  return Math.round((pesosNum + Number.EPSILON) * 100);
}

/** Centavos enteros → pesos (para escribir en `numeric(12,2)`). */
export function pesos(cent: number): number {
  return Math.round(cent) / 100;
}

/** `numeric` de PostgREST llega como número o texto: a número, o `null` si no hay dato (jamás 0 inventado). */
export function numeroONulo(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const RE_PERIODO = /^(\d{4})-(0[1-9]|1[0-2])-01$/;

/** ¿Es un primer día de mes `aaaa-mm-01` válido? */
export function esPeriodoValido(s: string | null | undefined): s is string {
  return typeof s === 'string' && RE_PERIODO.test(s);
}

/** El primer día del mes de una fecha `aaaa-mm-dd`. */
export function inicioDeMes(fecha: string): string {
  return `${fecha.slice(0, 7)}-01`;
}

/** El mes en curso de México como `aaaa-mm-01`. */
export function periodoMesActualMx(hoy: string = hoyMx()): string {
  return inicioDeMes(hoy);
}

/** El mes de México (primer día) en que cae un instante ISO (`pagada_en`, `conciliada_en`). `null` si el instante no es válido. */
export function mesDeInstanteMx(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return inicioDeMes(hoyMx(d));
}

/** Suma (o resta) meses a un `aaaa-mm-01`. Aritmética de calendario pura, sin reloj. */
export function sumarMeses(periodo: string, n: number): string {
  const [a, m] = periodo.split('-').map(Number);
  const idx = a * 12 + (m - 1) + n;
  const anio = Math.floor(idx / 12);
  const mes = (idx % 12) + 1;
  return `${anio}-${String(mes).padStart(2, '0')}-01`;
}

/** Meses completos entre dos `aaaa-mm-01` (b − a). */
export function mesesEntre(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/** El primer día del mes siguiente (límite exclusivo de un mes). */
export function finExclusivoDeMes(periodo: string): string {
  return sumarMeses(periodo, 1);
}

/** ¿Una referencia de banco/movimiento es creíble? Mismo piso que `conciliar` (≥ 3 caracteres útiles). */
export function referenciaValida(ref: string | null | undefined): ref is string {
  return typeof ref === 'string' && ref.trim().length >= 3;
}

/**
 * Lee un importe tecleado en un formulario (`FormDataEntryValue`). Vacío → `null`. Lo AMBIGUO («50,000») se rechaza, no se adivina; con
 * `dinero` también se rechaza lo que trae más de dos decimales (`numeric(12,2)` redondearía en silencio).
 */
export function importeDeTexto(valor: FormDataEntryValue | null | undefined, opts: { dinero?: boolean } = {}): number | null {
  const s = String(valor ?? '').trim();
  if (!s) return null;
  const n = parsearImporteMx(s);
  if (!Number.isFinite(n)) throw errBo('gastos.err_importe_ambiguo');
  if (opts.dinero && masDeDosDecimales(n)) throw errBo('gastos.err_decimales');
  return n;
}
