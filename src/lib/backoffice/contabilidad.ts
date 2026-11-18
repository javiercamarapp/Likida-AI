import { supabaseAdmin } from '@/lib/supabase/admin';
import { esTablaAusente, leerSeguro, NO_DISPONIBLE, OK, type Lectura } from './lectura';
import type { Cuenta } from './cuentas';
import type { Cumplimiento, EntidadLegal, EstadoCumplimiento, ObligacionFiscal } from './fiscal';
import { candadoDeEntidad, type Candado } from './fiscal';
import { insumosGastos } from './insumos-contables';
import { aCentavos, aPesos, comprobacionesLibro, delPeriodo, type AsientoLibro, type ComprobacionLibro, type LineaAsiento, type SoporteAsiento } from './libro';
import { armarPaquete, movimientosDe, OBLIGACIONES_DEL_PAQUETE, type CierreReferencia, type Paquete } from './paquete-contable';
import type { GastoMes, MovimientoContable } from './tipos';

// Entrada y salida (IO) del libro contable y del calendario fiscal. SOLO servidor, SOLO con `supabaseAdmin()` y SIEMPRE tras `requireSuperadmin()`
// (lo hace quien llama). Toda lectura devuelve `Lectura<T>`: una tabla que aún no se aplicó es «No disponible. No es cero.», no un libro vacío.
// El libro solo se escribe por `bo_asentar` / `bo_reversar_asiento` (migración 1014), que son idempotentes por clave. Este módulo NO llama al
// SAT ni a ningún servicio externo.

type Err = { code?: string; message?: string } | null | undefined;

/** Error de una escritura del libro, con el código de Postgres para que la acción lo diga en su idioma. */
export class ErrorLibro extends Error {
  constructor(public readonly codigo: string, public readonly detalle: string) {
    super(detalle);
    this.name = 'ErrorLibro';
  }
}

/** Clasifica el error de una escritura: `ausente` (la migración no está aplicada) o un código de Postgres. */
function aErrorLibro(e: Err): ErrorLibro {
  if (esTablaAusente(e)) return new ErrorLibro('ausente', e?.message ?? '');
  return new ErrorLibro(e?.code ?? 'desconocido', e?.message ?? '');
}

// ───────────────────────── Lecturas ─────────────────────────

export async function leerEntidad(): Promise<Lectura<EntidadLegal | null>> {
  const r = await supabaseAdmin().from('bo_entidad').select('rfc, razon_social, constituida_el').eq('id', 1).maybeSingle();
  if (r.error) return esTablaAusente(r.error) ? NO_DISPONIBLE : { estado: 'error', mensaje: r.error.message };
  if (!r.data) return OK(null);
  const f = r.data as { rfc: string | null; razon_social: string | null; constituida_el: string | null };
  return OK({ rfc: f.rfc, razonSocial: f.razon_social, constituidaEl: f.constituida_el });
}

export async function leerCuentas(): Promise<Lectura<Cuenta[]>> {
  const r = await supabaseAdmin().from('bo_cuenta').select('codigo, nombre, tipo, naturaleza, activa, propuesta, nota').order('codigo');
  if (r.error) return esTablaAusente(r.error) ? NO_DISPONIBLE : { estado: 'error', mensaje: r.error.message };
  return OK((r.data ?? []) as Cuenta[]);
}

interface FilaLinea { n: number; cuenta: string; debe: number | string; haber: number | string; nota: string | null }
interface FilaAsiento {
  id: string; seq: number; folio: string; clave_idem: string; fecha_neg: string; periodo: string; descripcion: string; origen_tipo: string;
  origen_id: string | null; soporte: SoporteAsiento; soporte_ref: string | null; reversa_de: string | null; motivo_reversa: string | null;
  es_manual: boolean; hash_anterior: string; hash: string; bo_asiento_linea: FilaLinea[] | null;
}

const PAGINA = 500;
const TOPE_PAGINAS = 100;
const COLUMNAS_ASIENTO =
  'id, seq, folio, clave_idem, fecha_neg, periodo, descripcion, origen_tipo, origen_id, soporte, soporte_ref, reversa_de, motivo_reversa, es_manual, hash_anterior, hash, bo_asiento_linea(n, cuenta, debe, haber, nota)';

export function asientoDeFila(f: FilaAsiento): AsientoLibro {
  const lineas: LineaAsiento[] = [...(f.bo_asiento_linea ?? [])]
    .sort((a, b) => a.n - b.n)
    .map((l) => ({ cuenta: l.cuenta, debeCent: aCentavos(l.debe), haberCent: aCentavos(l.haber), nota: l.nota }));
  return {
    id: f.id, seq: f.seq, folio: f.folio, claveIdem: f.clave_idem, fechaNeg: f.fecha_neg, periodo: f.periodo, descripcion: f.descripcion,
    origenTipo: f.origen_tipo, origenId: f.origen_id, soporte: f.soporte, soporteRef: f.soporte_ref, reversaDe: f.reversa_de, motivoReversa: f.motivo_reversa,
    esManual: f.es_manual, hashAnterior: f.hash_anterior, hash: f.hash, lineas,
  };
}

export interface LibroLeido {
  asientos: AsientoLibro[];
  /** true si se alcanzó el tope de lectura: la cadena y los acumulados NO son confiables y la pantalla lo dice. */
  truncado: boolean;
}

/** TODO el libro (la cadena de hash exige verlo completo, de seq 1 en adelante). Un libro vacío es `ok` con `[]`: «no hay asientos», un dato real. */
export async function leerLibro(): Promise<Lectura<LibroLeido>> {
  return leerSeguro(async () => {
    const sb = supabaseAdmin();
    const asientos: AsientoLibro[] = [];
    let truncado = false;
    for (let pagina = 0; ; pagina++) {
      if (pagina >= TOPE_PAGINAS) { truncado = true; break; }
      const r = await sb.from('bo_asiento').select(COLUMNAS_ASIENTO).order('seq', { ascending: true }).range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
      if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
      const filas = (r.data ?? []) as unknown as FilaAsiento[];
      asientos.push(...filas.map(asientoDeFila));
      if (filas.length < PAGINA) break;
    }
    return { asientos, truncado };
  });
}

/** Interfaz fijada por el plan: los movimientos contables del mes (una fila por línea de asiento), con su soporte documental. */
export async function leerMovimientosDelMes(periodo: string): Promise<Lectura<MovimientoContable[]>> {
  const libro = await leerLibro();
  if (libro.estado !== 'ok') return libro;
  return OK(movimientosDe(delPeriodo(libro.dato.asientos, periodo)));
}

export async function leerObligaciones(): Promise<Lectura<ObligacionFiscal[]>> {
  const r = await supabaseAdmin().from('bo_obligacion_fiscal')
    .select('clave, nombre, periodicidad, dia_limite, mes_limite, meses_desfase, requiere_entidad, estado_catalogo, nota').order('clave');
  if (r.error) return esTablaAusente(r.error) ? NO_DISPONIBLE : { estado: 'error', mensaje: r.error.message };
  const filas = (r.data ?? []) as Array<{
    clave: string; nombre: string; periodicidad: ObligacionFiscal['periodicidad']; dia_limite: number | null; mes_limite: number | null;
    meses_desfase: number; requiere_entidad: boolean; estado_catalogo: ObligacionFiscal['estadoCatalogo']; nota: string | null;
  }>;
  return OK(filas.map((f) => ({
    clave: f.clave, nombre: f.nombre, periodicidad: f.periodicidad, diaLimite: f.dia_limite, mesLimite: f.mes_limite, mesesDesfase: f.meses_desfase,
    requiereEntidad: f.requiere_entidad, estadoCatalogo: f.estado_catalogo, nota: f.nota,
  })));
}

interface FilaCumplimiento {
  clave: string; periodo: string; estado: EstadoCumplimiento; paquete_generado_en: string | null; presentada_por: string | null;
  presentada_en: string | null; acuse_ref: string | null; nota: string | null;
}
const COLUMNAS_CUMPLIMIENTO = 'clave, periodo, estado, paquete_generado_en, presentada_por, presentada_en, acuse_ref, nota';
const aCumplimiento = (f: FilaCumplimiento): Cumplimiento => ({
  clave: f.clave, periodo: f.periodo, estado: f.estado, paqueteGeneradoEn: f.paquete_generado_en, presentadaPor: f.presentada_por,
  presentadaEn: f.presentada_en, acuseRef: f.acuse_ref, nota: f.nota,
});

export async function leerCumplimientos(): Promise<Lectura<Cumplimiento[]>> {
  const r = await supabaseAdmin().from('bo_obligacion_cumplimiento').select(COLUMNAS_CUMPLIMIENTO).order('periodo', { ascending: false }).order('id').limit(500);
  if (r.error) return esTablaAusente(r.error) ? NO_DISPONIBLE : { estado: 'error', mensaje: r.error.message };
  return OK(((r.data ?? []) as FilaCumplimiento[]).map(aCumplimiento));
}

/** El cierre del mes que ya existe en `bo_cierre_mes` (lote A), leído por tabla —no por código— para no depender de A. `cierre: null` = el mes no tiene cierre. */
export async function leerCierreReferencia(periodo: string): Promise<Lectura<{ cierre: CierreReferencia | null; ivaTrasladadoCent: number | null }>> {
  const r = await supabaseAdmin().from('bo_cierre_mes')
    .select('periodo, ingresos_cobrados, iva_trasladado, cogs_ia, gastos_operativos, comisiones_devengadas').eq('periodo', periodo).maybeSingle();
  if (r.error) return esTablaAusente(r.error) ? NO_DISPONIBLE : { estado: 'error', mensaje: r.error.message };
  if (!r.data) return OK({ cierre: null, ivaTrasladadoCent: null });
  const f = r.data as { periodo: string; ingresos_cobrados: number | null; iva_trasladado: number | null; cogs_ia: number | null; gastos_operativos: number | null; comisiones_devengadas: number | null };
  const cent = (x: number | null): number | null => (x === null || x === undefined ? null : aCentavos(x));
  const partes = [cent(f.cogs_ia), cent(f.gastos_operativos), cent(f.comisiones_devengadas)];
  // «Costos y gastos» solo existe si TODOS sus componentes existen: un componente null no se suma como cero.
  const costosYGastosCent = partes.some((p) => p === null) ? null : partes.reduce<number>((s, p) => s + (p ?? 0), 0);
  return OK({ cierre: { periodo: f.periodo, ingresosCent: cent(f.ingresos_cobrados), costosYGastosCent }, ivaTrasladadoCent: cent(f.iva_trasladado) });
}

/** RFC de cada proveedor (por id), para la DIOT. Un proveedor sin RFC queda con null: no se adivina. */
export async function leerRfcProveedores(): Promise<Lectura<Record<string, string | null>>> {
  const r = await supabaseAdmin().from('bo_proveedor').select('id, rfc');
  if (r.error) return esTablaAusente(r.error) ? NO_DISPONIBLE : { estado: 'error', mensaje: r.error.message };
  return OK(Object.fromEntries(((r.data ?? []) as Array<{ id: string; rfc: string | null }>).map((f) => [f.id, f.rfc])));
}

export interface PeriodoContable {
  periodo: string;
  estado: 'abierto' | 'preparado' | 'aprobado' | 'publicado';
}

/** El estado del periodo contable; `null` si aún no hay fila (un mes sin asientos todavía es «abierto» de hecho, pero no se inventa). */
export async function leerPeriodoContable(periodo: string): Promise<Lectura<PeriodoContable | null>> {
  const r = await supabaseAdmin().from('bo_periodo_contable').select('periodo, estado').eq('periodo', periodo).maybeSingle();
  if (r.error) return esTablaAusente(r.error) ? NO_DISPONIBLE : { estado: 'error', mensaje: r.error.message };
  return OK((r.data as PeriodoContable | null) ?? null);
}

// ───────────────────────── Escrituras ─────────────────────────

export interface AsientoNuevo {
  /** Clave de idempotencia: repetir la misma clave devuelve el mismo asiento. */
  claveIdem: string;
  fecha: string;
  descripcion: string;
  lineas: readonly LineaAsiento[];
  actor: string;
  soporte?: SoporteAsiento;
  soporteRef?: string | null;
  origenTipo?: string;
  origenId?: string | null;
}

/** Asienta una póliza por `bo_asentar` (cuadre, cuentas, periodo y cadena de hash los valida la base). Devuelve el id; la misma clave devuelve el mismo asiento. */
export async function registrarAsiento(a: AsientoNuevo): Promise<{ id: string }> {
  const r = await supabaseAdmin().rpc('bo_asentar', {
    p_clave_idem: a.claveIdem,
    p_fecha: a.fecha,
    p_descripcion: a.descripcion,
    p_origen_tipo: a.origenTipo ?? 'manual',
    p_origen_id: a.origenId ?? null,
    p_soporte: a.soporte ?? 'ninguno',
    p_soporte_ref: a.soporteRef ?? null,
    p_actor: a.actor,
    p_lineas: a.lineas.map((l) => ({ cuenta: l.cuenta, debe: aPesos(l.debeCent), haber: aPesos(l.haberCent), nota: l.nota ?? null })),
  });
  if (r.error) throw aErrorLibro(r.error);
  return { id: String(r.data) };
}

/** Reversa enlazada (solo asientos manuales, una vez, con motivo). Idempotente por `claveIdem`. */
export async function reversarAsiento(p: { asientoId: string; motivo: string; actor: string; claveIdem: string; fecha: string }): Promise<{ id: string }> {
  const r = await supabaseAdmin().rpc('bo_reversar_asiento', {
    p_asiento: p.asientoId, p_motivo: p.motivo, p_actor: p.actor, p_clave_idem: p.claveIdem, p_fecha: p.fecha,
  });
  if (r.error) throw aErrorLibro(r.error);
  return { id: String(r.data) };
}

/** Asegura que exista la fila del periodo y la devuelve (para el cierre mensual, que avanza el estado). */
export async function asegurarPeriodo(periodo: string): Promise<void> {
  const r = await supabaseAdmin().rpc('bo_asegurar_periodo', { p_periodo: periodo });
  if (r.error) throw aErrorLibro(r.error);
}

/** abierto → preparado → aprobado → publicado (la base rechaza saltos). Lo usa el cierre mensual (lote A). */
export async function avanzarPeriodo(periodo: string, estado: 'preparado' | 'aprobado' | 'publicado' | 'abierto', actor: string): Promise<void> {
  await asegurarPeriodo(periodo);
  const ahora = new Date().toISOString();
  const cambios: Record<string, unknown> =
    estado === 'preparado' ? { estado, preparado_en: ahora }
      : estado === 'aprobado' ? { estado, aprobado_en: ahora, aprobado_por: actor }
        : estado === 'publicado' ? { estado, publicado_en: ahora }
          : { estado };
  const r = await supabaseAdmin().from('bo_periodo_contable').update(cambios).eq('periodo', periodo);
  if (r.error) throw aErrorLibro(r.error);
}

/** Reabre un periodo aprobado o publicado (motivo obligatorio; deja huella en `bo_periodo_reapertura`). */
export async function reabrirPeriodo(periodo: string, motivo: string, actor: string): Promise<void> {
  const r = await supabaseAdmin().rpc('bo_reabrir_periodo', { p_periodo: periodo, p_motivo: motivo, p_actor: actor });
  if (r.error) throw aErrorLibro(r.error);
}

/**
 * Marca «presentada» una obligación del periodo. La marca una PERSONA con el acuse en la mano: sin quién, cuándo y referencia no se guarda
 * (la base lo exige también). Idempotente: repetir con el mismo acuse no cambia nada; con otro acuse sobre una ya presentada, se rechaza.
 */
export async function marcarPresentada(p: { clave: string; periodo: string; presentadaPor: string; presentadaEn: string; acuseRef: string; nota?: string | null }): Promise<'marcada' | 'ya_estaba'> {
  const sb = supabaseAdmin();
  const previa = await sb.from('bo_obligacion_cumplimiento').select(COLUMNAS_CUMPLIMIENTO).eq('clave', p.clave).eq('periodo', p.periodo).maybeSingle();
  if (previa.error) throw aErrorLibro(previa.error);
  const existente = previa.data as FilaCumplimiento | null;
  if (existente?.estado === 'presentada') {
    if (existente.acuse_ref === p.acuseRef) return 'ya_estaba';
    throw new ErrorLibro('42501', 'ya presentada con otro acuse');
  }
  const r = await sb.from('bo_obligacion_cumplimiento').upsert({
    clave: p.clave, periodo: p.periodo, estado: 'presentada', presentada_por: p.presentadaPor, presentada_en: p.presentadaEn, acuse_ref: p.acuseRef, nota: p.nota ?? null,
  }, { onConflict: 'clave,periodo' });
  if (r.error) throw aErrorLibro(r.error);
  return 'marcada';
}

/** Marca «paquete listo» las obligaciones que el paquete del mes deja preparadas (no toca las ya presentadas ni las «no aplica»). Devuelve las claves marcadas. */
export async function marcarPaqueteListo(periodo: string): Promise<string[]> {
  const sb = supabaseAdmin();
  const previas = await sb.from('bo_obligacion_cumplimiento').select(COLUMNAS_CUMPLIMIENTO).eq('periodo', periodo).in('clave', [...OBLIGACIONES_DEL_PAQUETE]);
  if (previas.error) throw aErrorLibro(previas.error);
  const cerradas = new Set(((previas.data ?? []) as FilaCumplimiento[]).filter((f) => f.estado === 'presentada' || f.estado === 'no_aplica').map((f) => f.clave));
  const claves = OBLIGACIONES_DEL_PAQUETE.filter((c) => !cerradas.has(c));
  if (claves.length === 0) return [];
  const ahora = new Date().toISOString();
  const r = await sb.from('bo_obligacion_cumplimiento').upsert(
    claves.map((clave) => ({ clave, periodo, estado: 'paquete_listo', paquete_generado_en: ahora })),
    { onConflict: 'clave,periodo' },
  );
  if (r.error) throw aErrorLibro(r.error);
  return [...claves];
}

// ───────────────────────── Lectura compuesta del mes ─────────────────────────

export interface DatosDelMes {
  entidad: Lectura<EntidadLegal | null>;
  candado: Candado;
  cuentas: Lectura<Cuenta[]>;
  libro: Lectura<LibroLeido>;
  /** Comprobaciones por dos vías sobre TODO el libro; null si no se pudo leer el libro o las cuentas. */
  comprobaciones: ComprobacionLibro[] | null;
  /** Asientos del mes; null si no se pudo leer el libro. */
  delMes: AsientoLibro[] | null;
  /** Gastos del mes (lote C) y cierre (lote A): solo se piden con entidad con RFC; si no, `no_disponible` sin consultar. */
  gastos: Lectura<GastoMes[]>;
  cierre: Lectura<{ cierre: CierreReferencia | null; ivaTrasladadoCent: number | null }>;
  /** null si no se pudo armar (libro o cuentas ilegibles). Con candado cerrado es `{ bloqueado: ... }`. */
  paquete: Paquete | null;
}

/** Todo lo que la pantalla y la acción de «paquete listo» necesitan del mes, leído una sola vez y armado con las funciones puras. */
export async function leerPaqueteDelMes(periodo: string): Promise<DatosDelMes> {
  const [entidad, cuentas, libro] = await Promise.all([leerEntidad(), leerCuentas(), leerLibro()]);
  const candado = candadoDeEntidad(entidad);
  const abierto = !candado.bloqueado;
  const [gastos, cierre, rfc] = abierto
    ? await Promise.all([insumosGastos(periodo), leerCierreReferencia(periodo), leerRfcProveedores()])
    : [NO_DISPONIBLE as Lectura<GastoMes[]>, NO_DISPONIBLE as Lectura<{ cierre: CierreReferencia | null; ivaTrasladadoCent: number | null }>, NO_DISPONIBLE as Lectura<Record<string, string | null>>];
  const todos = libro.estado === 'ok' ? libro.dato.asientos : null;
  const cuentasOk = cuentas.estado === 'ok' ? cuentas.dato : null;
  const delMes = todos ? delPeriodo(todos, periodo) : null;
  const comprobaciones = todos && cuentasOk ? comprobacionesLibro(todos, cuentasOk) : null;
  const paquete = delMes && cuentasOk && comprobaciones
    ? armarPaquete({
      periodo, candado, asientos: delMes, cuentas: cuentasOk, comprobaciones,
      gastos: gastos.estado === 'ok' ? gastos.dato : null,
      rfcPorProveedor: rfc.estado === 'ok' ? rfc.dato : {},
      cierre: cierre.estado === 'ok' ? cierre.dato.cierre : null,
      ivaTrasladadoCent: cierre.estado === 'ok' ? cierre.dato.ivaTrasladadoCent : null,
    })
    : null;
  return { entidad, candado, cuentas, libro, comprobaciones, delMes, gastos, cierre, paquete };
}
