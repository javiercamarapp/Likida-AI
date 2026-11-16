// La entidad legal propia de Likida (una sola fila, `bo_entidad`, id = 1). Hoy Likida no tiene razón social ni RFC propios (la SAPI aún no se
// constituye): mientras `rfc` sea null, la contabilidad fiscal, la DIOT, el CFDI de gastos y el «deducible en forma» NO son evaluables, y el
// código nunca rellena nada en su lugar. La validación es PURA; la lectura y la escritura toleran que la tabla aún no exista.
import { supabaseAdmin } from '@/lib/supabase/admin';
import { hoyMx } from '@/lib/formato';
import { esRfcValido, rfcChecksumOk } from '@/lib/likida/intake/cfdi';
import { desdeRespuesta, esTablaAusente, type Lectura } from './lectura';

export interface Entidad {
  razonSocial: string | null;
  /** `null` = Likida aún no tiene RFC propio. */
  rfc: string | null;
  regimenFiscal: string | null;
  domicilioFiscalCp: string | null;
  /** `AAAA-MM-DD` o null. */
  constituidaEl: string | null;
}

export interface EntidadGuardada extends Entidad {
  actualizadaPor: string | null;
  actualizadaEn: string | null;
}

export const ENTIDAD_VACIA: Entidad = { razonSocial: null, rfc: null, regimenFiscal: null, domicilioFiscalCp: null, constituidaEl: null };

/** El candado que ven todas las pantallas fiscales. `desconocido` = no se pudo leer la entidad (no se asume ni «con RFC» ni «sin RFC»). */
export type CandadoEntidad = 'sin_rfc' | 'con_rfc' | 'desconocido';

export type CampoEntidad = 'razonSocial' | 'rfc' | 'regimenFiscal' | 'domicilioFiscalCp' | 'constituidaEl';
/** Códigos de error por campo; la pantalla los traduce con su diccionario. */
export type ErrorCampoEntidad =
  | 'razon_social_larga' | 'razon_social_falta' | 'rfc_forma' | 'rfc_digito' | 'rfc_generico'
  | 'regimen_largo' | 'cp_invalido' | 'fecha_invalida' | 'fecha_futura';

/** RFC genéricos del SAT (público en general y extranjeros): no pueden ser el RFC propio de una empresa. */
const RFC_GENERICOS = new Set(['XAXX010101000', 'XEXX010101000']);

/** Texto recortado o `null` si quedó vacío. */
export function textoONulo(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t === '' ? null : t;
}

/** El RFC como se guarda: mayúsculas y solo letras, dígitos, Ñ y &. Vacío → null. */
export function normalizarRfc(crudo: unknown): string | null {
  const t = textoONulo(crudo);
  if (t === null) return null;
  return t.toUpperCase().replace(/[^A-ZÑ&0-9]/g, '');
}

/** ¿`AAAA-MM-DD` y el día existe? */
export function esFechaIsoReal(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, mes - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === mes - 1 && f.getUTCDate() === d;
}

export type ValidacionEntidad =
  | { ok: true; valor: Entidad }
  | { ok: false; errores: Partial<Record<CampoEntidad, ErrorCampoEntidad>> };

/**
 * Valida y normaliza lo que se captura. Todo es opcional MENOS la coherencia: un RFC pide razón social (no hay RFC sin nombre), el RFC
 * debe pasar forma Y dígito verificador (un RFC mal tecleado se descubre tres semanas después ante el SAT), no puede ser genérico, el CP
 * lleva 5 dígitos y la fecha de constitución existe y no es futura (`hoy` es el día de México; se inyecta para las pruebas).
 */
export function validarEntidad(entrada: Record<CampoEntidad, unknown>, hoy: string = hoyMx()): ValidacionEntidad {
  const errores: Partial<Record<CampoEntidad, ErrorCampoEntidad>> = {};
  const razonSocial = textoONulo(entrada.razonSocial);
  const rfc = normalizarRfc(entrada.rfc);
  const regimenFiscal = textoONulo(entrada.regimenFiscal);
  const cp = textoONulo(entrada.domicilioFiscalCp);
  const constituidaEl = textoONulo(entrada.constituidaEl);

  if (razonSocial !== null && razonSocial.length > 200) errores.razonSocial = 'razon_social_larga';
  if (rfc !== null) {
    if (RFC_GENERICOS.has(rfc)) errores.rfc = 'rfc_generico';
    else if (!esRfcValido(rfc)) errores.rfc = 'rfc_forma';
    else if (!rfcChecksumOk(rfc)) errores.rfc = 'rfc_digito';
    if (razonSocial === null && !errores.razonSocial) errores.razonSocial = 'razon_social_falta';
  }
  if (regimenFiscal !== null && regimenFiscal.length > 80) errores.regimenFiscal = 'regimen_largo';
  if (cp !== null && !/^\d{5}$/.test(cp)) errores.domicilioFiscalCp = 'cp_invalido';
  if (constituidaEl !== null) {
    if (!esFechaIsoReal(constituidaEl)) errores.constituidaEl = 'fecha_invalida';
    else if (constituidaEl > hoy) errores.constituidaEl = 'fecha_futura';
  }
  if (Object.keys(errores).length > 0) return { ok: false, errores };
  return { ok: true, valor: { razonSocial, rfc, regimenFiscal, domicilioFiscalCp: cp, constituidaEl } };
}

/** PURA. El candado a partir de la lectura de la entidad. Una lectura que falló NO es «sin RFC» ni «con RFC»: es `desconocido`. */
export function candadoDeEntidad(lectura: Lectura<EntidadGuardada | null>): CandadoEntidad {
  if (lectura.estado === 'no_disponible') return 'sin_rfc'; // la tabla no existe: ninguna entidad se capturó jamás
  if (lectura.estado !== 'ok') return 'desconocido';
  return lectura.dato?.rfc ? 'con_rfc' : 'sin_rfc';
}

/** Lo que devuelve una función de paquete cuando falta el RFC propio: nada fiscal se arma. */
export const BLOQUEADO_SIN_RFC = { bloqueado: 'sin_rfc' } as const;

interface FilaEntidad {
  razon_social: string | null;
  rfc: string | null;
  regimen_fiscal: string | null;
  domicilio_fiscal_cp: string | null;
  constituida_el: string | null;
  actualizada_por: string | null;
  actualizada_en: string | null;
}

/** PURA. La fila de la base como `EntidadGuardada`. */
export function entidadDeFila(f: FilaEntidad): EntidadGuardada {
  return {
    razonSocial: f.razon_social,
    rfc: f.rfc,
    regimenFiscal: f.regimen_fiscal,
    domicilioFiscalCp: f.domicilio_fiscal_cp,
    constituidaEl: f.constituida_el,
    actualizadaPor: f.actualizada_por,
    actualizadaEn: f.actualizada_en,
  };
}

/** Lee la entidad. `ok` con `null` = la tabla existe y aún no hay entidad capturada; `no_disponible` = la migración no está aplicada. */
export async function leerEntidad(): Promise<Lectura<EntidadGuardada | null>> {
  try {
    const r = desdeRespuesta(
      await supabaseAdmin()
        .from('bo_entidad')
        .select('razon_social, rfc, regimen_fiscal, domicilio_fiscal_cp, constituida_el, actualizada_por, actualizada_en')
        .eq('id', 1)
        .maybeSingle(),
    );
    if (r.estado !== 'ok') return r;
    return { estado: 'ok', dato: r.dato ? entidadDeFila(r.dato as FilaEntidad) : null };
  } catch (e) {
    return { estado: 'error', mensaje: e instanceof Error ? e.message : String(e) };
  }
}

/** La tabla `bo_entidad` aún no existe en esa base: la pantalla dice «No disponible», no un error genérico. */
export class EntidadNoDisponible extends Error {
  constructor() { super('bo_entidad no disponible'); this.name = 'EntidadNoDisponible'; }
}

/** Guarda (upsert de la fila id = 1). LANZA si la base responde error: la acción lo dice, no finge que se guardó. */
export async function guardarEntidad(valor: Entidad, actorId: string): Promise<void> {
  const { error } = await supabaseAdmin().from('bo_entidad').upsert(
    {
      id: 1,
      razon_social: valor.razonSocial,
      rfc: valor.rfc,
      regimen_fiscal: valor.regimenFiscal,
      domicilio_fiscal_cp: valor.domicilioFiscalCp,
      constituida_el: valor.constituidaEl,
      actualizada_por: actorId,
      actualizada_en: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (!error) return;
  if (esTablaAusente(error)) throw new EntidadNoDisponible();
  throw new Error(`guardarEntidad: ${error.message}`);
}
