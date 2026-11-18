// Contratos de Likida misma (tabla `bo_contrato`, migración 1011). Validación PURA + lectura/escritura con `supabaseAdmin()` (solo servidor, tras `requireSuperadmin()`).
// Toda lectura devuelve `Lectura<T>`: una tabla aún no aplicada es `no_disponible`, no «0 contratos».
import { supabaseAdmin } from '@/lib/supabase/admin';
import { esTablaAusente, leerSeguro, type Lectura } from './lectura';
import { DIAS_AVISO } from '@/lib/likida/vigencias';
import { TIPOS_CONTRATO, type EstadoContrato, type TipoContrato } from './vencimientos';

export interface Contrato {
  id: string;
  tipo: TipoContrato;
  contraparte: string;
  tenantId: string | null;
  descripcion: string | null;
  firmadoEl: string | null;
  venceEl: string | null;
  renovacionAuto: boolean;
  diasAviso: number[];
  responsable: string | null;
  costoMensualCent: number | null;
  documentoUrl: string | null;
  estado: EstadoContrato;
  motivoTerminacion: string | null;
  creadoEn: string;
}

/** Lo que captura la forma (todo texto, como llega de un FormData). */
export interface EntradaContrato {
  tipo: string;
  contraparte: string;
  descripcion?: string;
  firmadoEl?: string;
  venceEl?: string;
  renovacionAuto?: boolean;
  /** «60, 30» o vacío (entonces rige la ventana del tipo o `DIAS_AVISO`). */
  diasAviso?: string;
  responsable?: string;
  /** Pesos, p. ej. «1,250.50». */
  costoMensual?: string;
  documentoUrl?: string;
  estado?: string;
}

export type ErrorContrato =
  | 'tipo' | 'contraparte' | 'descripcion' | 'firmado_fecha' | 'vence_fecha' | 'vence_antes_de_firma' | 'dias_aviso' | 'responsable'
  | 'costo' | 'documento_url' | 'estado' | 'sin_rfc' | 'motivo' | 'no_encontrado' | 'terminado' | 'duplicado' | 'tabla';

export interface ContratoValido {
  tipo: TipoContrato;
  contraparte: string;
  descripcion: string | null;
  firmadoEl: string | null;
  venceEl: string | null;
  renovacionAuto: boolean;
  diasAviso: number[];
  responsable: string | null;
  costoMensualCent: number | null;
  documentoUrl: string | null;
  estado: 'borrador' | 'vigente';
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fechaReal = (f: string): boolean => FECHA.test(f) && !Number.isNaN(Date.parse(`${f}T00:00:00Z`)) && new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) === f;
const limpio = (s: string | undefined): string => (s ?? '').trim();

/** «60, 30» → [60, 30]; vacío → `porOmision`. null si algún valor no es un entero de 1 a 365, o hay más de 6. */
export function parsearDiasAviso(texto: string | undefined, porOmision: readonly number[] = [DIAS_AVISO]): number[] | null {
  const t = limpio(texto);
  if (t === '') return [...porOmision];
  const partes = t.split(/[\s,;]+/).filter(Boolean);
  const nums = partes.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (nums.length === 0 || nums.length > 6 || nums.some((n) => !Number.isInteger(n) || n < 1 || n > 365)) return null;
  return [...new Set(nums)].sort((a, b) => b - a);
}

/** Pesos tecleados → centavos enteros; null si no es una cantidad ≥ 0 con a lo más 2 decimales. */
export function parsearPesosACentavos(texto: string): number | null {
  const t = texto.trim().replace(/[$\s]/g, '').replace(/,/g, '');
  if (!/^\d{1,10}$/.test(t) && !/^\d{1,10}\.\d{1,2}$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/**
 * Valida y normaliza lo capturado. Devuelve el primer error con su código (la acción lo traduce). El estado que se puede capturar es
 * `borrador` o `vigente`: «terminado» se hace solo con `terminarContrato` (motivo obligatorio); «por renovar» y «vencido» se calculan.
 */
export function validarContrato(e: EntradaContrato): { ok: true; valor: ContratoValido } | { ok: false; error: ErrorContrato } {
  const tipo = limpio(e.tipo) as TipoContrato;
  if (!TIPOS_CONTRATO.includes(tipo)) return { ok: false, error: 'tipo' };
  const contraparte = limpio(e.contraparte);
  if (contraparte === '' || contraparte.length > 200) return { ok: false, error: 'contraparte' };
  const descripcion = limpio(e.descripcion);
  if (descripcion.length > 1000) return { ok: false, error: 'descripcion' };
  const firmadoEl = limpio(e.firmadoEl);
  if (firmadoEl !== '' && !fechaReal(firmadoEl)) return { ok: false, error: 'firmado_fecha' };
  const venceEl = limpio(e.venceEl);
  if (venceEl !== '' && !fechaReal(venceEl)) return { ok: false, error: 'vence_fecha' };
  if (firmadoEl !== '' && venceEl !== '' && venceEl < firmadoEl) return { ok: false, error: 'vence_antes_de_firma' };
  const diasAviso = parsearDiasAviso(e.diasAviso);
  if (diasAviso === null) return { ok: false, error: 'dias_aviso' };
  const responsable = limpio(e.responsable);
  if (responsable.length > 120) return { ok: false, error: 'responsable' };
  const costoTxt = limpio(e.costoMensual);
  const costoMensualCent = costoTxt === '' ? null : parsearPesosACentavos(costoTxt);
  if (costoTxt !== '' && costoMensualCent === null) return { ok: false, error: 'costo' };
  const url = limpio(e.documentoUrl);
  if (url !== '' && (url.length > 500 || !/^https?:\/\//i.test(url))) return { ok: false, error: 'documento_url' };
  const estado = limpio(e.estado) === '' ? 'borrador' : limpio(e.estado);
  if (estado !== 'borrador' && estado !== 'vigente') return { ok: false, error: 'estado' };
  return {
    ok: true,
    valor: {
      tipo, contraparte,
      descripcion: descripcion === '' ? null : descripcion,
      firmadoEl: firmadoEl === '' ? null : firmadoEl,
      venceEl: venceEl === '' ? null : venceEl,
      renovacionAuto: e.renovacionAuto === true,
      diasAviso,
      responsable: responsable === '' ? null : responsable,
      costoMensualCent,
      documentoUrl: url === '' ? null : url,
      estado,
    },
  };
}

/**
 * Candado de entidad: Likida aún no tiene razón social ni RFC propios, y un contrato de CLIENTE no puede pasar a firmado (fecha de firma o
 * estado distinto de borrador) sin `bo_entidad.rfc`. `rfc` null o vacío = bloqueado. Los demás tipos no se bloquean.
 */
export function exigeEntidad(c: Pick<ContratoValido, 'tipo' | 'estado' | 'firmadoEl'>, rfcEntidad: string | null): ErrorContrato | null {
  if (c.tipo !== 'cliente') return null;
  const firmado = c.firmadoEl !== null || c.estado !== 'borrador';
  if (!firmado) return null;
  return rfcEntidad && rfcEntidad.trim() !== '' ? null : 'sin_rfc';
}

/** Un motivo de terminación vale si tiene al menos 5 caracteres con letras (la base exige lo mismo). */
export function motivoValido(m: string | undefined): string | null {
  const t = limpio(m);
  return t.length >= 5 && t.length <= 500 ? t : null;
}

// ── Lectura y escritura ───────────────────────────────────────────────────────

const COLS = 'id,tipo,contraparte,tenant_id,descripcion,firmado_el,vence_el,renovacion_auto,dias_aviso,responsable,costo_mensual_mxn,documento_url,estado,motivo_terminacion,creado_en';

interface FilaBd {
  id: string; tipo: TipoContrato; contraparte: string; tenant_id: string | null; descripcion: string | null; firmado_el: string | null; vence_el: string | null;
  renovacion_auto: boolean; dias_aviso: number[] | null; responsable: string | null; costo_mensual_mxn: number | string | null; documento_url: string | null;
  estado: EstadoContrato; motivo_terminacion: string | null; creado_en: string;
}

export function contratoDeFila(f: FilaBd): Contrato {
  return {
    id: f.id, tipo: f.tipo, contraparte: f.contraparte, tenantId: f.tenant_id, descripcion: f.descripcion, firmadoEl: f.firmado_el, venceEl: f.vence_el,
    renovacionAuto: f.renovacion_auto, diasAviso: f.dias_aviso && f.dias_aviso.length > 0 ? f.dias_aviso : [DIAS_AVISO], responsable: f.responsable,
    costoMensualCent: f.costo_mensual_mxn === null ? null : Math.round(Number(f.costo_mensual_mxn) * 100),
    documentoUrl: f.documento_url, estado: f.estado, motivoTerminacion: f.motivo_terminacion, creadoEn: f.creado_en,
  };
}

const TOPE_FILAS = 1000;

export async function listarContratos(): Promise<Lectura<Contrato[]>> {
  return leerSeguro(async () => {
    const r = await supabaseAdmin().from('bo_contrato').select(COLS).order('vence_el', { ascending: true, nullsFirst: false }).order('id').limit(TOPE_FILAS);
    if (r.error) throw r.error;
    return ((r.data ?? []) as unknown as FilaBd[]).map(contratoDeFila);
  });
}

/** El RFC de la entidad (Lote A, `bo_entidad`). `ok(null)` = la entidad existe sin RFC; `no_disponible` = la tabla aún no existe. Ambos bloquean la firma de contratos de cliente. */
export async function leerRfcEntidad(): Promise<Lectura<string | null>> {
  return leerSeguro(async () => {
    const r = await supabaseAdmin().from('bo_entidad').select('rfc').eq('id', 1).maybeSingle();
    if (r.error) throw r.error;
    return (r.data as { rfc: string | null } | null)?.rfc ?? null;
  });
}

function columnasDe(v: ContratoValido): Record<string, unknown> {
  return {
    tipo: v.tipo, contraparte: v.contraparte, descripcion: v.descripcion, firmado_el: v.firmadoEl, vence_el: v.venceEl, renovacion_auto: v.renovacionAuto,
    dias_aviso: v.diasAviso, responsable: v.responsable, costo_mensual_mxn: v.costoMensualCent === null ? null : v.costoMensualCent / 100,
    documento_url: v.documentoUrl, estado: v.estado,
  };
}

type Resultado = { ok: true; id: string } | { ok: false; error: ErrorContrato };

function errorDeEscritura(e: { code?: string; message?: string } | null): ErrorContrato | null {
  if (!e) return null;
  if (esTablaAusente(e)) return 'tabla';
  if (e.code === '23505') return 'duplicado';
  if (/terminado no se edita/i.test(e.message ?? '')) return 'terminado';
  return null;
}

export async function crearContrato(entrada: EntradaContrato, actorId: string | null): Promise<Resultado> {
  const v = validarContrato(entrada);
  if (!v.ok) return v;
  const rfc = await leerRfcEntidad();
  const bloqueo = exigeEntidad(v.valor, rfc.estado === 'ok' ? rfc.dato : null);
  if (bloqueo) return { ok: false, error: bloqueo };
  const r = await supabaseAdmin().from('bo_contrato').insert({ ...columnasDe(v.valor), creado_por: actorId }).select('id').single();
  if (r.error) {
    const e = errorDeEscritura(r.error);
    if (e) return { ok: false, error: e };
    throw r.error;
  }
  return { ok: true, id: (r.data as { id: string }).id };
}

export async function actualizarContrato(id: string, entrada: EntradaContrato): Promise<Resultado> {
  const v = validarContrato(entrada);
  if (!v.ok) return v;
  const actual = await supabaseAdmin().from('bo_contrato').select('id,estado').eq('id', id).maybeSingle();
  if (actual.error) {
    const e = errorDeEscritura(actual.error);
    if (e) return { ok: false, error: e };
    throw actual.error;
  }
  if (!actual.data) return { ok: false, error: 'no_encontrado' };
  if ((actual.data as { estado: string }).estado === 'terminado') return { ok: false, error: 'terminado' };
  const rfc = await leerRfcEntidad();
  const bloqueo = exigeEntidad(v.valor, rfc.estado === 'ok' ? rfc.dato : null);
  if (bloqueo) return { ok: false, error: bloqueo };
  const r = await supabaseAdmin().from('bo_contrato').update(columnasDe(v.valor)).eq('id', id).select('id').maybeSingle();
  if (r.error) {
    const e = errorDeEscritura(r.error);
    if (e) return { ok: false, error: e };
    throw r.error;
  }
  return r.data ? { ok: true, id } : { ok: false, error: 'no_encontrado' };
}

/** Termina un contrato (motivo obligatorio). La fila queda congelada: no se edita después. */
export async function terminarContrato(id: string, motivo: string): Promise<Resultado> {
  const m = motivoValido(motivo);
  if (m === null) return { ok: false, error: 'motivo' };
  const r = await supabaseAdmin().from('bo_contrato').update({ estado: 'terminado', motivo_terminacion: m }).eq('id', id).neq('estado', 'terminado').select('id').maybeSingle();
  if (r.error) {
    const e = errorDeEscritura(r.error);
    if (e) return { ok: false, error: e };
    throw r.error;
  }
  return r.data ? { ok: true, id } : { ok: false, error: 'no_encontrado' };
}
