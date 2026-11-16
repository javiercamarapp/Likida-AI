import { createHash } from 'node:crypto';
import { masDeDosDecimales, parsearImporteMx } from '@/lib/formato';
import type { Cuenta, Naturaleza, TipoCuenta } from './cuentas';

// Núcleo PURO del libro contable de partida doble de Likida (porte adaptado de ~/rtm/src/dominio/contabilidad/asiento.ts y de las
// comprobaciones de `20261110001900_f3b_contabilidad_estados.sql`). Todo en CENTAVOS enteros (sufijo Cent); los pesos solo viven en la base
// (`numeric(12,2)`) y se convierten en el borde con `aCentavos`. Sin IO, sin SAT, sin red: lo que entra es lo que se calcula.

/** Pesos (como llegan de la base o del formulario) a centavos enteros. */
export function aCentavos(pesos: number | string): number {
  return Math.round(Number(pesos) * 100);
}

/** Centavos enteros a pesos (solo para el borde con la base). */
export function aPesos(cent: number): number {
  return cent / 100;
}

export interface LineaAsiento {
  cuenta: string;
  debeCent: number;
  haberCent: number;
  nota?: string | null;
}

export type SoporteAsiento = 'cfdi' | 'invoice_extranjero' | 'ninguno';

export interface AsientoLibro {
  id: string;
  seq: number;
  folio: string;
  claveIdem: string;
  fechaNeg: string;
  /** Primer día del mes del asiento (aaaa-mm-01). */
  periodo: string;
  descripcion: string;
  origenTipo: string;
  origenId: string | null;
  soporte: SoporteAsiento;
  soporteRef: string | null;
  reversaDe: string | null;
  motivoReversa: string | null;
  esManual: boolean;
  hashAnterior: string;
  hash: string;
  /** En el orden de `n` (1, 2, 3…). */
  lineas: LineaAsiento[];
}

// ───────────────────────── Validación de un asiento propuesto ─────────────────────────

export type ErrorAsiento =
  | { tipo: 'pocas_lineas' }
  | { tipo: 'cuenta_invalida'; cuenta: string }
  | { tipo: 'cuenta_inexistente'; cuenta: string }
  | { tipo: 'cuenta_inactiva'; cuenta: string }
  | { tipo: 'monto_invalido'; cuenta: string }
  | { tipo: 'debe_y_haber'; cuenta: string }
  | { tipo: 'descuadre'; debeCent: number; haberCent: number };

const CUENTA = /^[0-9]{4}$/;

export function sumas(lineas: readonly Pick<LineaAsiento, 'debeCent' | 'haberCent'>[]): { debeCent: number; haberCent: number } {
  let debeCent = 0;
  let haberCent = 0;
  for (const l of lineas) {
    debeCent += l.debeCent;
    haberCent += l.haberCent;
  }
  return { debeCent, haberCent };
}

/**
 * Es la misma regla que aplica la base (bo_asentar + trigger de cuadre diferido) y se corre ANTES de intentar guardar: al menos dos líneas,
 * cada una con un solo lado y mayor que cero, centavos enteros, cuentas bien formadas (y existentes y activas si se pasa el catálogo) y
 * Σ debe = Σ haber. Devuelve TODOS los errores, no solo el primero.
 */
export function validarAsiento(lineas: readonly LineaAsiento[], cuentas?: readonly Cuenta[]): ErrorAsiento[] {
  const errores: ErrorAsiento[] = [];
  if (lineas.length < 2) errores.push({ tipo: 'pocas_lineas' });
  const catalogo = cuentas ? new Map(cuentas.map((c) => [c.codigo, c])) : null;
  for (const l of lineas) {
    if (!CUENTA.test(l.cuenta)) errores.push({ tipo: 'cuenta_invalida', cuenta: l.cuenta });
    else if (catalogo) {
      const c = catalogo.get(l.cuenta);
      if (!c) errores.push({ tipo: 'cuenta_inexistente', cuenta: l.cuenta });
      else if (!c.activa) errores.push({ tipo: 'cuenta_inactiva', cuenta: l.cuenta });
    }
    const entero = Number.isInteger(l.debeCent) && Number.isInteger(l.haberCent);
    if (!entero || l.debeCent < 0 || l.haberCent < 0) errores.push({ tipo: 'monto_invalido', cuenta: l.cuenta });
    else if ((l.debeCent > 0) === (l.haberCent > 0)) errores.push({ tipo: 'debe_y_haber', cuenta: l.cuenta });
  }
  const s = sumas(lineas);
  if (s.debeCent !== s.haberCent) errores.push({ tipo: 'descuadre', ...s });
  return errores;
}

export function asientoCuadra(lineas: readonly LineaAsiento[]): boolean {
  return validarAsiento(lineas).length === 0;
}

/** Reversa: las mismas líneas con los lados invertidos. El motivo y el enlace los pone la base. */
export function invertir(lineas: readonly LineaAsiento[]): LineaAsiento[] {
  return lineas.map((l) => ({ cuenta: l.cuenta, debeCent: l.haberCent, haberCent: l.debeCent, nota: l.nota ?? null }));
}

/** ¿La reversa neutraliza al original, cuenta por cuenta? */
export function reversaNeutraliza(original: readonly LineaAsiento[], reversa: readonly LineaAsiento[]): boolean {
  const neto = new Map<string, number>();
  for (const l of [...original, ...reversa]) neto.set(l.cuenta, (neto.get(l.cuenta) ?? 0) + l.debeCent - l.haberCent);
  return [...neto.values()].every((v) => v === 0);
}

/** Saldo de una cuenta en su naturaleza (deudora: debe − haber; acreedora: haber − debe). */
export function saldoNatural(naturaleza: Naturaleza, debeCent: number, haberCent: number): number {
  return naturaleza === 'D' ? debeCent - haberCent : haberCent - debeCent;
}

/** Efecto de un movimiento sobre el TIPO de cuenta: A, C y G suman por el debe; P, K e I por el haber (una contra-cuenta resta sola). */
export function efectoPorTipo(tipo: TipoCuenta, debeCent: number, haberCent: number): number {
  return tipo === 'A' || tipo === 'C' || tipo === 'G' ? debeCent - haberCent : haberCent - debeCent;
}

// ───────────────────────── Filtros por periodo ─────────────────────────

/** Los asientos de UN mes (`periodo` = aaaa-mm-01). */
export function delPeriodo(asientos: readonly AsientoLibro[], periodo: string): AsientoLibro[] {
  return asientos.filter((a) => a.periodo === periodo);
}

/** Los asientos de ese mes y de los anteriores (para el balance general, que es acumulado). */
export function hastaPeriodo(asientos: readonly AsientoLibro[], periodo: string): AsientoLibro[] {
  return asientos.filter((a) => a.periodo <= periodo);
}

// ───────────────────────── Balanza, resultados y balance ─────────────────────────

export interface FilaBalanza {
  cuenta: string;
  nombre: string;
  /** null = una cuenta que no está en el catálogo (se muestra, no se esconde). */
  tipo: TipoCuenta | null;
  naturaleza: Naturaleza;
  debeCent: number;
  haberCent: number;
  /** Saldo en la naturaleza de la cuenta. */
  saldoCent: number;
}

export interface Balanza {
  filas: FilaBalanza[];
  totalDebeCent: number;
  totalHaberCent: number;
  diferenciaCent: number;
  cuadra: boolean;
  sinCatalogo: string[];
}

function acumular(asientos: readonly AsientoLibro[]): Map<string, { debeCent: number; haberCent: number }> {
  const m = new Map<string, { debeCent: number; haberCent: number }>();
  for (const a of asientos) {
    for (const l of a.lineas) {
      const x = m.get(l.cuenta) ?? { debeCent: 0, haberCent: 0 };
      x.debeCent += l.debeCent;
      x.haberCent += l.haberCent;
      m.set(l.cuenta, x);
    }
  }
  return m;
}

/** Balanza de comprobación: solo las cuentas con movimiento, ordenadas por código. */
export function armarBalanza(asientos: readonly AsientoLibro[], cuentas: readonly Cuenta[]): Balanza {
  const catalogo = new Map(cuentas.map((c) => [c.codigo, c]));
  const filas: FilaBalanza[] = [];
  const sinCatalogo: string[] = [];
  for (const [cuenta, x] of [...acumular(asientos).entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const c = catalogo.get(cuenta);
    if (!c) sinCatalogo.push(cuenta);
    const naturaleza: Naturaleza = c?.naturaleza ?? 'D';
    filas.push({ cuenta, nombre: c?.nombre ?? cuenta, tipo: c?.tipo ?? null, naturaleza, debeCent: x.debeCent, haberCent: x.haberCent, saldoCent: saldoNatural(naturaleza, x.debeCent, x.haberCent) });
  }
  const t = sumas(filas);
  return { filas, totalDebeCent: t.debeCent, totalHaberCent: t.haberCent, diferenciaCent: t.debeCent - t.haberCent, cuadra: t.debeCent === t.haberCent, sinCatalogo };
}

export interface LineaResultado {
  cuenta: string;
  nombre: string;
  tipo: 'I' | 'C' | 'G';
  montoCent: number;
}

export interface EstadoResultados {
  ingresosCent: number;
  costosCent: number;
  gastosCent: number;
  utilidadBrutaCent: number;
  resultadoCent: number;
  porCuenta: LineaResultado[];
  /** false = ningún asiento tocó cuentas de resultados: la pantalla dice «sin movimientos», no «0 de utilidad». */
  hayMovimientos: boolean;
}

/** Estado de resultados de los asientos que se le pasen (el llamador ya filtró el mes). Resultado = ingresos − costos − gastos. */
export function estadoDeResultados(asientos: readonly AsientoLibro[], cuentas: readonly Cuenta[]): EstadoResultados {
  const catalogo = new Map(cuentas.map((c) => [c.codigo, c]));
  const porCuenta: LineaResultado[] = [];
  let ingresosCent = 0;
  let costosCent = 0;
  let gastosCent = 0;
  for (const [cuenta, x] of [...acumular(asientos).entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const c = catalogo.get(cuenta);
    if (!c || (c.tipo !== 'I' && c.tipo !== 'C' && c.tipo !== 'G')) continue;
    const montoCent = efectoPorTipo(c.tipo, x.debeCent, x.haberCent);
    porCuenta.push({ cuenta, nombre: c.nombre, tipo: c.tipo, montoCent });
    if (c.tipo === 'I') ingresosCent += montoCent;
    else if (c.tipo === 'C') costosCent += montoCent;
    else gastosCent += montoCent;
  }
  return { ingresosCent, costosCent, gastosCent, utilidadBrutaCent: ingresosCent - costosCent, resultadoCent: ingresosCent - costosCent - gastosCent, porCuenta, hayMovimientos: porCuenta.length > 0 };
}

export interface BalanceGeneral {
  activoCent: number;
  pasivoCent: number;
  capitalCent: number;
  /** Resultado acumulado de ingresos, costos y gastos (aún no traspasado a capital). */
  resultadoCent: number;
  /** activo − (pasivo + capital + resultado): debe ser 0. */
  diferenciaCent: number;
  cuadra: boolean;
}

/** Balance general ACUMULADO de los asientos que se le pasen. La identidad es activo = pasivo + capital + resultado. */
export function balanceGeneral(asientos: readonly AsientoLibro[], cuentas: readonly Cuenta[]): BalanceGeneral {
  const catalogo = new Map(cuentas.map((c) => [c.codigo, c]));
  const por: Record<TipoCuenta, number> = { A: 0, P: 0, K: 0, I: 0, C: 0, G: 0 };
  for (const [cuenta, x] of acumular(asientos)) {
    const c = catalogo.get(cuenta);
    if (c) por[c.tipo] += efectoPorTipo(c.tipo, x.debeCent, x.haberCent);
  }
  const resultadoCent = por.I - por.C - por.G;
  const diferenciaCent = por.A - (por.P + por.K + resultadoCent);
  return { activoCent: por.A, pasivoCent: por.P, capitalCent: por.K, resultadoCent, diferenciaCent, cuadra: diferenciaCent === 0 };
}

// ───────────────────────── Cadena de hash ─────────────────────────

export const HASH_CERO = '0'.repeat(64);

/** Folio de la base: «A-» + el número con ceros a la izquierda hasta 4 dígitos (sin truncar los más largos). */
export function folioDe(seq: number): string {
  return `A-${String(seq).padStart(4, '0')}`;
}

/** Texto canónico de las líneas: `n:cuenta:debeCent:haberCent` unido por `;` (idéntico al `bo_lineas_canon` del SQL). */
export function lineasCanon(lineas: readonly LineaAsiento[]): string {
  return lineas.map((l, i) => `${i + 1}:${l.cuenta}:${l.debeCent}:${l.haberCent}`).join(';');
}

export function textoCanonico(a: Pick<AsientoLibro, 'folio' | 'claveIdem' | 'fechaNeg' | 'origenTipo' | 'reversaDe' | 'lineas'>): string {
  return [a.folio, a.claveIdem, a.fechaNeg, a.origenTipo, a.reversaDe ?? '', lineasCanon(a.lineas)].join('|');
}

export function hashDe(anterior: string, texto: string): string {
  return createHash('sha256').update(`${anterior}|${texto}`, 'utf8').digest('hex');
}

export interface ResultadoCadena {
  integra: boolean;
  /** Folio del primer asiento roto; null si está íntegra. */
  primerRotoFolio: string | null;
  motivo: 'hash' | 'enlace' | null;
  /** Huecos de numeración (asientos que faltan entre el primero y el último). */
  huecos: number;
}

/**
 * Recalcula la cadena: cada asiento debe enlazar con el hash del anterior (el primero con ceros) y su hash debe corresponder a su contenido.
 * `desdeInicio: false` verifica una porción (no exige que empiece en 1 ni en ceros).
 */
export function verificarCadenaHash(asientos: readonly AsientoLibro[], opciones: { desdeInicio?: boolean } = {}): ResultadoCadena {
  const desdeInicio = opciones.desdeInicio ?? true;
  const orden = [...asientos].sort((a, b) => a.seq - b.seq);
  const roto: { folio: string | null; motivo: ResultadoCadena['motivo'] } = { folio: null, motivo: null };
  let huecos = 0;
  for (let i = 0; i < orden.length; i++) {
    const a = orden[i];
    const previo = i > 0 ? orden[i - 1] : null;
    if (previo) huecos += Math.max(0, a.seq - previo.seq - 1);
    else if (desdeInicio) huecos += Math.max(0, a.seq - 1);
    if (roto.folio !== null) continue;
    const esperado = previo ? previo.hash : desdeInicio ? HASH_CERO : a.hashAnterior;
    if (a.hashAnterior !== esperado) { roto.folio = a.folio; roto.motivo = 'enlace'; continue; }
    if (hashDe(a.hashAnterior, textoCanonico(a)) !== a.hash) { roto.folio = a.folio; roto.motivo = 'hash'; }
  }
  return { integra: roto.folio === null && huecos === 0, primerRotoFolio: roto.folio, motivo: roto.motivo, huecos };
}

// ───────────────────────── Comprobaciones por DOS vías ─────────────────────────

export interface ViaComprobacion {
  nombre: string;
  /** null = no se pudo medir esa vía (jamás 0). */
  cent: number | null;
}

export interface ComprobacionLibro {
  codigo: 'C3' | 'C4' | 'C10' | 'C21' | 'CU1';
  /** Nombre en español (la pantalla usa su propio diccionario por código). */
  nombre: string;
  /** Una comprobación bloqueante en rojo impide marcar el paquete como listo. */
  bloqueante: boolean;
  viaA: ViaComprobacion;
  viaB: ViaComprobacion;
  /** null = no evaluable (por ejemplo, sin auxiliar contra el cual comparar): no es verde ni rojo. */
  ok: boolean | null;
}

/** Un saldo medido FUERA del libro (p. ej. bancos de tesorería, clientes por cobrar de las facturas) contra el que se compara el mayor. */
export interface AuxiliarLibro {
  cuenta: string;
  fuente: string;
  saldoCent: number | null;
}

/**
 * Las comprobaciones del libro, cada una por dos vías independientes. El auxiliar (C4) llega por parámetro: sin auxiliares, C4 queda
 * `ok: null` («no evaluable»), no verde. Con un auxiliar sin dato (`saldoCent: null`) también queda null: no se inventa un cero.
 */
export function comprobacionesLibro(asientos: readonly AsientoLibro[], cuentas: readonly Cuenta[], opciones: { auxiliares?: readonly AuxiliarLibro[] } = {}): ComprobacionLibro[] {
  const lineas = asientos.flatMap((a) => a.lineas);
  const total = sumas(lineas);
  const salida: ComprobacionLibro[] = [];

  salida.push({
    codigo: 'C3', nombre: 'Balanza: suma del debe contra suma del haber', bloqueante: true,
    viaA: { nombre: 'Suma del debe', cent: total.debeCent }, viaB: { nombre: 'Suma del haber', cent: total.haberCent }, ok: total.debeCent === total.haberCent,
  });

  const descuadrados = asientos.filter((a) => { const s = sumas(a.lineas); return s.debeCent !== s.haberCent || a.lineas.length < 2; }).length;
  salida.push({
    codigo: 'C10', nombre: 'Asientos cuadrados: ninguno con debe distinto de haber', bloqueante: true,
    viaA: { nombre: 'Asientos descuadrados', cent: descuadrados }, viaB: { nombre: 'Esperados', cent: 0 }, ok: descuadrados === 0,
  });

  const aux = opciones.auxiliares ?? [];
  if (aux.length === 0) {
    salida.push({ codigo: 'C4', nombre: 'Auxiliares contra cuentas de control', bloqueante: false, viaA: { nombre: 'Mayor', cent: null }, viaB: { nombre: 'Auxiliar', cent: null }, ok: null });
  } else {
    const catalogo = new Map(cuentas.map((c) => [c.codigo, c]));
    const mayor = acumular(asientos);
    let sinDato = false;
    let mayorTotal = 0;
    let auxTotal = 0;
    let todos = true;
    for (const x of aux) {
      const c = catalogo.get(x.cuenta);
      const m = mayor.get(x.cuenta) ?? { debeCent: 0, haberCent: 0 };
      const saldoMayor = saldoNatural(c?.naturaleza ?? 'D', m.debeCent, m.haberCent);
      if (x.saldoCent === null) { sinDato = true; continue; }
      mayorTotal += saldoMayor;
      auxTotal += x.saldoCent;
      if (saldoMayor !== x.saldoCent) todos = false;
    }
    salida.push({
      codigo: 'C4', nombre: 'Auxiliares contra cuentas de control', bloqueante: false,
      viaA: { nombre: 'Mayor', cent: sinDato ? null : mayorTotal }, viaB: { nombre: 'Auxiliar', cent: sinDato ? null : auxTotal }, ok: sinDato ? null : todos,
    });
  }

  const cadena = verificarCadenaHash(asientos);
  salida.push({
    codigo: 'C21', nombre: 'Cadena de hash íntegra y folios sin huecos', bloqueante: true,
    viaA: { nombre: 'Asiento roto (1) y huecos', cent: (cadena.primerRotoFolio === null ? 0 : 1) + cadena.huecos }, viaB: { nombre: 'Esperado', cent: 0 }, ok: cadena.integra,
  });

  const b = balanceGeneral(asientos, cuentas);
  salida.push({
    codigo: 'CU1', nombre: 'Identidad: activo igual a pasivo más capital más resultado', bloqueante: true,
    viaA: { nombre: 'Activo', cent: b.activoCent }, viaB: { nombre: 'Pasivo más capital más resultado', cent: b.pasivoCent + b.capitalCent + b.resultadoCent }, ok: b.cuadra,
  });
  return salida;
}

/** Las comprobaciones bloqueantes que están en rojo (ok === false). Una no evaluable (null) no bloquea, pero tampoco aprueba. */
export function bloqueantesEnRojo(comprobaciones: readonly ComprobacionLibro[]): ComprobacionLibro[] {
  return comprobaciones.filter((c) => c.bloqueante && c.ok === false);
}

// ───────────────────────── Formulario de asiento manual ─────────────────────────

/** Renglones de captura del formulario de asiento manual. */
export const LINEAS_FORMA = 6;

export type ErrorFormaAsiento = { n: number; tipo: 'monto_ilegible' | 'mas_de_dos_decimales' };

/**
 * Lee los renglones `cuenta_1..N`, `debe_1..N`, `haber_1..N` de un formulario. Un renglón totalmente vacío se ignora; uno con un
 * importe ilegible o con más de dos decimales NO se adivina: se devuelve el error y la acción no guarda.
 */
export function lineasDeFormulario(leer: (campo: string) => string, renglones = LINEAS_FORMA): { lineas: LineaAsiento[]; errores: ErrorFormaAsiento[] } {
  const lineas: LineaAsiento[] = [];
  const errores: ErrorFormaAsiento[] = [];
  for (let n = 1; n <= renglones; n++) {
    const cuenta = leer(`cuenta_${n}`).trim();
    const debeTxt = leer(`debe_${n}`).trim();
    const haberTxt = leer(`haber_${n}`).trim();
    if (!cuenta && !debeTxt && !haberTxt) continue;
    const importe = (txt: string): number | 'mal' | 'dec' => {
      if (!txt) return 0;
      const v = parsearImporteMx(txt);
      if (!Number.isFinite(v) || v < 0) return 'mal';
      if (masDeDosDecimales(txt.replace(',', '.')) && /[.,]\d{3,}$/.test(txt)) return 'dec';
      return aCentavos(v);
    };
    const d = importe(debeTxt);
    const h = importe(haberTxt);
    if (d === 'mal' || h === 'mal') { errores.push({ n, tipo: 'monto_ilegible' }); continue; }
    if (d === 'dec' || h === 'dec') { errores.push({ n, tipo: 'mas_de_dos_decimales' }); continue; }
    lineas.push({ cuenta, debeCent: d, haberCent: h });
  }
  return { lineas, errores };
}
