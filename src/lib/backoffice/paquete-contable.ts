import { celdaCsvSegura } from '@/lib/csv_seguro';
import type { Candado } from './fiscal';
import type { Cuenta } from './cuentas';
import {
  armarBalanza, bloqueantesEnRojo, estadoDeResultados, type AsientoLibro, type Balanza, type ComprobacionLibro, type EstadoResultados,
} from './libro';
import type { GastoMes, MovimientoContable } from './tipos';

// Paquete contable mensual para el contador. PURO: arma archivos y cifras, no presenta, no consulta y no llama al SAT.
//  · Sin RFC propio (SAPI sin constituir) el paquete queda «Bloqueado» y NO se rellena nada: `{ bloqueado: 'sin_rfc' }`.
//  · Los CSV son genéricos («no es layout CONTPAQi»); el catálogo oficial y el layout electrónico están pendientes de contador.
//  · El cruce contra el cierre muestra la diferencia y NO ajusta nada.
//  · La DIOT solo toma gastos con RFC de proveedor; los demás quedan pendientes con su motivo.
//  · «A pagar» de IVA es null si algún gasto no declara su IVA acreditable: no se inventa un cero.

// ───────────────────────── CSV genérico ─────────────────────────

const MARCA_SIN_CFDI = 'SIN CFDI — no incluir sin revisión';
const MARCA_EXTRANJERO = 'Invoice extranjero — revisar con el contador';

/** Centavos enteros a «1234.50» (con signo), sin pasar por coma flotante ni por localización: es un archivo para máquinas. */
export function pesosCsv(cent: number): string {
  const signo = cent < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cent));
  return `${signo}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Un campo de TEXTO listo para el archivo: entrecomillado RFC 4180 y fórmulas de hoja de cálculo (= + - @) neutralizadas (`lib/csv_seguro.ts`). */
export function campoCsv(valor: string | null | undefined): string {
  return celdaCsvSegura(valor ?? '');
}

function filaCsv(campos: readonly string[]): string {
  return campos.join(',');
}

/** Balanza de comprobación en CSV genérico (cuenta, nombre, tipo, naturaleza, debe, haber, saldo). */
export function balanzaCsv(balanza: Balanza): string {
  const filas = [filaCsv(['cuenta', 'nombre', 'tipo', 'naturaleza', 'debe', 'haber', 'saldo'])];
  for (const f of balanza.filas) {
    filas.push(filaCsv([f.cuenta, campoCsv(f.nombre), f.tipo ?? '', f.naturaleza, pesosCsv(f.debeCent), pesosCsv(f.haberCent), pesosCsv(f.saldoCent)]));
  }
  filas.push(filaCsv(['TOTAL', '', '', '', pesosCsv(balanza.totalDebeCent), pesosCsv(balanza.totalHaberCent), '']));
  return filas.join('\n');
}

/** La marca que acompaña a un movimiento según su soporte documental. Vacía si tiene CFDI. */
export function marcaDeSoporte(soporte: MovimientoContable['soporte']): string {
  if (soporte === 'ninguno') return MARCA_SIN_CFDI;
  if (soporte === 'invoice_extranjero') return MARCA_EXTRANJERO;
  return '';
}

/** De asientos a movimientos (una fila por línea), con el soporte del asiento. */
export function movimientosDe(asientos: readonly AsientoLibro[]): MovimientoContable[] {
  return asientos.flatMap((a) => a.lineas.map((l) => ({
    asientoId: a.id, fecha: a.fechaNeg, cuenta: l.cuenta, debeCent: l.debeCent, haberCent: l.haberCent, concepto: l.nota ?? a.descripcion, soporte: a.soporte,
  })));
}

/** Pólizas (movimientos) en CSV genérico. Todo movimiento sin CFDI lleva «SIN CFDI — no incluir sin revisión». */
export function polizasCsv(movimientos: readonly MovimientoContable[], folios: ReadonlyMap<string, string> = new Map()): string {
  const filas = [filaCsv(['folio', 'fecha', 'cuenta', 'debe', 'haber', 'concepto', 'soporte', 'marca'])];
  for (const m of movimientos) {
    filas.push(filaCsv([
      campoCsv(folios.get(m.asientoId) ?? m.asientoId), m.fecha, m.cuenta, pesosCsv(m.debeCent), pesosCsv(m.haberCent), campoCsv(m.concepto), m.soporte, campoCsv(marcaDeSoporte(m.soporte)),
    ]));
  }
  return filas.join('\n');
}

/** Cuántos movimientos no traen CFDI (soporte «ninguno»). */
export function movimientosSinCfdi(movimientos: readonly MovimientoContable[]): number {
  return movimientos.filter((m) => m.soporte === 'ninguno').length;
}

// ───────────────────────── Cruce contra el cierre mensual ─────────────────────────

/** Lo que el paquete necesita del cierre mensual (lote A): por parámetro, para no depender de él. `null` = el cierre no trae ese dato. */
export interface CierreReferencia {
  periodo: string;
  ingresosCent: number | null;
  costosYGastosCent: number | null;
}

export interface FilaCruce {
  concepto: 'ingresos' | 'costos_y_gastos';
  libroCent: number;
  cierreCent: number | null;
  /** libro − cierre; null si el cierre no trae el dato. */
  diferenciaCent: number | null;
  cuadra: boolean | null;
}

export interface CruceCierre {
  /** true = las dos cifras coinciden; false = hay diferencia; null = el cierre no trae datos para comparar. */
  cuadra: boolean | null;
  /** SIEMPRE false: el cruce muestra la diferencia, jamás la ajusta ni asienta nada. */
  ajusta: false;
  filas: FilaCruce[];
}

export function cruzarContraCierre(resultados: EstadoResultados, cierre: CierreReferencia | null): CruceCierre {
  const fila = (concepto: FilaCruce['concepto'], libroCent: number, cierreCent: number | null): FilaCruce => {
    const c = cierre === null ? null : cierreCent;
    return { concepto, libroCent, cierreCent: c, diferenciaCent: c === null ? null : libroCent - c, cuadra: c === null ? null : libroCent === c };
  };
  const filas = [
    fila('ingresos', resultados.ingresosCent, cierre?.ingresosCent ?? null),
    fila('costos_y_gastos', resultados.costosCent + resultados.gastosCent, cierre?.costosYGastosCent ?? null),
  ];
  const cuadra = filas.some((f) => f.cuadra === false) ? false : filas.some((f) => f.cuadra === null) ? null : true;
  return { cuadra, ajusta: false, filas };
}

// ───────────────────────── DIOT ─────────────────────────

export type MotivoPendienteDiot = 'sin_comprobante' | 'invoice_extranjero' | 'sin_cfdi_uuid' | 'sin_rfc_proveedor' | 'rfc_invalido' | 'sin_desglose';

export interface RenglonDiot {
  rfc: string;
  proveedor: string | null;
  operaciones: number;
  baseCent: number;
  ivaCent: number;
  totalCent: number;
}

export interface PendienteDiot {
  gastoId: string;
  proveedor: string | null;
  motivo: MotivoPendienteDiot;
  totalCent: number;
}

export interface Diot {
  renglones: RenglonDiot[];
  pendientes: PendienteDiot[];
  baseTotalCent: number;
  ivaTotalCent: number;
}

const RFC = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/;

/**
 * Renglones de DIOT por RFC de proveedor. Solo entran gastos con CFDI, UUID, RFC válido del proveedor y desglose (subtotal e IVA
 * declarados). Todo lo demás queda en `pendientes` con su motivo: no se adivina un RFC ni se reparte un total.
 */
export function armarDiot(gastos: readonly GastoMes[], rfcPorProveedor: Readonly<Record<string, string | null | undefined>>): Diot {
  const grupos = new Map<string, RenglonDiot>();
  const pendientes: PendienteDiot[] = [];
  for (const g of gastos) {
    const pendiente = (motivo: MotivoPendienteDiot) => pendientes.push({ gastoId: g.id, proveedor: g.proveedor, motivo, totalCent: g.totalCent });
    if (g.comprobante === 'sin_comprobante') { pendiente('sin_comprobante'); continue; }
    if (g.comprobante === 'invoice_extranjero') { pendiente('invoice_extranjero'); continue; }
    if (!g.cfdiUuid) { pendiente('sin_cfdi_uuid'); continue; }
    const rfcBruto = g.proveedorId ? rfcPorProveedor[g.proveedorId] : null;
    const rfc = rfcBruto?.trim().toUpperCase() ?? '';
    if (!rfc) { pendiente('sin_rfc_proveedor'); continue; }
    if (!RFC.test(rfc)) { pendiente('rfc_invalido'); continue; }
    if (g.subtotalCent === null || g.ivaAcreditableCent === null) { pendiente('sin_desglose'); continue; }
    const r = grupos.get(rfc) ?? { rfc, proveedor: g.proveedor, operaciones: 0, baseCent: 0, ivaCent: 0, totalCent: 0 };
    r.operaciones += 1;
    r.baseCent += g.subtotalCent;
    r.ivaCent += g.ivaAcreditableCent;
    r.totalCent += g.subtotalCent + g.ivaAcreditableCent;
    grupos.set(rfc, r);
  }
  const renglones = [...grupos.values()].sort((a, b) => a.rfc.localeCompare(b.rfc));
  return { renglones, pendientes, baseTotalCent: renglones.reduce((s, r) => s + r.baseCent, 0), ivaTotalCent: renglones.reduce((s, r) => s + r.ivaCent, 0) };
}

// ───────────────────────── Resumen de IVA ─────────────────────────

export type MotivoIvaSinDato = 'sin_trasladado' | 'gasto_sin_iva' | 'sin_gastos_leidos';

export interface ResumenIva {
  trasladadoCent: number | null;
  /** Suma del IVA acreditable de los gastos CON CFDI que lo declaran; null si no se leyeron los gastos. */
  acreditableCent: number | null;
  /** trasladado − acreditable (negativo = saldo a favor). null si falta el trasladado o algún gasto no declara su IVA acreditable. */
  aPagarCent: number | null;
  motivoSinDato: MotivoIvaSinDato | null;
  /** Gastos que no declaran IVA acreditable (ni siquiera cero): son la razón de un «a pagar» null. */
  gastosSinIva: string[];
}

export function resumenIva(entrada: { ivaTrasladadoCent: number | null; gastos: readonly GastoMes[] | null }): ResumenIva {
  const { ivaTrasladadoCent, gastos } = entrada;
  if (gastos === null) {
    return { trasladadoCent: ivaTrasladadoCent, acreditableCent: null, aPagarCent: null, motivoSinDato: 'sin_gastos_leidos', gastosSinIva: [] };
  }
  const gastosSinIva = gastos.filter((g) => g.ivaAcreditableCent === null).map((g) => g.id);
  const acreditableCent = gastos.reduce((s, g) => s + (g.comprobante === 'cfdi' && g.ivaAcreditableCent !== null ? g.ivaAcreditableCent : 0), 0);
  const motivoSinDato: MotivoIvaSinDato | null = ivaTrasladadoCent === null ? 'sin_trasladado' : gastosSinIva.length > 0 ? 'gasto_sin_iva' : null;
  return {
    trasladadoCent: ivaTrasladadoCent,
    acreditableCent,
    aPagarCent: motivoSinDato === null && ivaTrasladadoCent !== null ? ivaTrasladadoCent - acreditableCent : null,
    motivoSinDato,
    gastosSinIva,
  };
}

// ───────────────────────── Paquete completo ─────────────────────────

export type MotivoBloqueo = 'sin_rfc' | 'entidad_no_disponible' | 'entidad_no_leida';
export type Advertencia = 'cruce_no_cuadra' | 'cruce_sin_cierre' | 'diot_con_pendientes' | 'diot_sin_gastos' | 'iva_a_pagar_sin_dato' | 'movimientos_sin_cfdi';
/** Las obligaciones que este paquete deja preparadas: balanza (contabilidad electrónica), DIOT e IVA del mismo mes. */
export const OBLIGACIONES_DEL_PAQUETE = ['contabilidad_electronica', 'diot', 'iva_mensual'] as const;

export type MotivoNoListo = 'comprobacion_bloqueante' | 'sin_movimientos';

export interface EntradaPaquete {
  periodo: string;
  candado: Candado;
  /** Los asientos DEL periodo. */
  asientos: readonly AsientoLibro[];
  cuentas: readonly Cuenta[];
  comprobaciones: readonly ComprobacionLibro[];
  /** null = no se pudieron leer los gastos: la DIOT y el IVA quedan «sin dato», no en cero. */
  gastos: readonly GastoMes[] | null;
  rfcPorProveedor: Readonly<Record<string, string | null | undefined>>;
  cierre: CierreReferencia | null;
  ivaTrasladadoCent: number | null;
}

export type PaqueteBloqueado = { bloqueado: MotivoBloqueo };

export interface PaqueteArmado {
  bloqueado: false;
  periodo: string;
  balanza: Balanza;
  resultados: EstadoResultados;
  balanzaCsv: string;
  polizasCsv: string;
  movimientos: MovimientoContable[];
  movimientosSinCfdi: number;
  cruce: CruceCierre;
  /** null = sin gastos leídos. */
  diot: Diot | null;
  iva: ResumenIva;
  advertencias: Advertencia[];
  /** «Listo» = nada bloqueante en rojo y hay movimientos. NO significa presentado: eso lo marca una persona con acuse. */
  listo: boolean;
  motivosNoListo: MotivoNoListo[];
}

export type Paquete = PaqueteBloqueado | PaqueteArmado;

/** Arma el paquete del mes. Sin entidad con RFC devuelve `{ bloqueado: 'sin_rfc' }` y nada más. */
export function armarPaquete(e: EntradaPaquete): Paquete {
  if (e.candado.bloqueado) return { bloqueado: e.candado.motivo };
  const balanza = armarBalanza(e.asientos, e.cuentas);
  const resultados = estadoDeResultados(e.asientos, e.cuentas);
  const movimientos = movimientosDe(e.asientos);
  const folios = new Map(e.asientos.map((a) => [a.id, a.folio]));
  const cruce = cruzarContraCierre(resultados, e.cierre);
  const diot = e.gastos === null ? null : armarDiot(e.gastos, e.rfcPorProveedor);
  const iva = resumenIva({ ivaTrasladadoCent: e.ivaTrasladadoCent, gastos: e.gastos });
  const sinCfdi = movimientosSinCfdi(movimientos);

  const advertencias: Advertencia[] = [];
  if (cruce.cuadra === false) advertencias.push('cruce_no_cuadra');
  else if (cruce.cuadra === null) advertencias.push('cruce_sin_cierre');
  if (diot === null) advertencias.push('diot_sin_gastos');
  else if (diot.pendientes.length > 0) advertencias.push('diot_con_pendientes');
  if (iva.aPagarCent === null) advertencias.push('iva_a_pagar_sin_dato');
  if (sinCfdi > 0) advertencias.push('movimientos_sin_cfdi');

  const motivosNoListo: MotivoNoListo[] = [];
  if (bloqueantesEnRojo(e.comprobaciones).length > 0) motivosNoListo.push('comprobacion_bloqueante');
  if (movimientos.length === 0) motivosNoListo.push('sin_movimientos');

  return {
    bloqueado: false, periodo: e.periodo, balanza, resultados,
    balanzaCsv: balanzaCsv(balanza), polizasCsv: polizasCsv(movimientos, folios),
    movimientos, movimientosSinCfdi: sinCfdi, cruce, diot, iva, advertencias,
    listo: motivosNoListo.length === 0, motivosNoListo,
  };
}
