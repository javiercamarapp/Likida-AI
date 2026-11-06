// ═══════════════════════════════════════════════════════════════════════════
// RECEPCIÓN DEL FORMATO «muestra-tms» EN `POST /v1/liquidaciones-externas/desgloses` (ronda 6).
//
//   ⚠ CONTRATO SUPUESTO hasta recibir la especificación oficial del sistema de transporte del cliente. Esta pieza solo conoce la
//   MUESTRA que el cliente entregó el 5-nov-2026 (ver `desglose_muestra_tms.ts`): sin envoltorio, versión, zona horaria, paginación
//   ni autenticación confirmados. Cuando llegue la especificación oficial se ajusta ESTE archivo y el convertidor; la ruta no cambia.
//
// Qué hace (y qué no):
//   · Reconoce el formato por su FORMA y lo versiona. Sobre: `{ "formato": "muestra-tms", "version": 1, "bitacoras": [ … ] }`, o UNA
//     bitácora suelta (un objeto con `BitacoraID`). El contrato interno actual jamás trae `formato` ni `BitacoraID` (su validador
//     rechaza campos desconocidos), así que reconocer la muestra no puede confundirse con él ni cambiarle el comportamiento.
//   · Validación estricta del sobre: campos desconocidos, versión no soportada, más de 100 bitácoras o más de 100 renglones por
//     bloque ⇒ 400 y no se procesa NADA. Un cuerpo mixto (muestra + contrato interno) también es 400.
//   · Cada bitácora la convierte `convertirBitacoraMuestra` (montos en centavos desde su texto, jamás flotantes; fechas
//     `yyyy-MM-dd HH:mm:ss` como hora de México; operador por NOMBRE contra el padrón del tenant). Lo que no es seguro NO se arregla:
//     la bitácora queda EN REVISIÓN con su motivo y NO se recibe ni se envía. Una bitácora mala no tumba a las demás.
//   · Una `BitacoraID` repetida dentro del mismo lote manda AMBAS a revisión (no se adivina cuál vale).
//   · Las revisiones se registran en la bandeja de excepciones que ya existe (`liquidacion_excepcion`, sin migración):
//     operador no identificado / ambiguo ⇒ `operador_no_encontrado`; cualquier otro motivo ⇒ `mapeo_invalido`. En el detalle
//     viajan SOLO la bitácora, el motivo y el NOMBRE DEL CAMPO: nunca el nombre del operador ni valores personales.
//   · La muestra no trae póliza: lo que sí se recibe pasa por `recibirDesglose` y queda en `sin_poliza` (no se envía) hasta
//     que haya póliza. Eso es lo correcto con este contrato; no se inventa una póliza.
//   · APAGADO por defecto y FALLA CERRADO: exige la bandera de plataforma `LIKIDA_TMS_MUESTRA=si`, los interruptores `global` y
//     `agente:liquidacion` encendidos, y que la flota tenga «Activar el envío» con canal correo. Cualquier error de lectura = apagado.
//
// PRIVACIDAD: el texto de los chats NO interviene aquí. Los nombres de operador llegan en el cuerpo, se comparan en memoria y no
// se registran en logs ni en la bandeja de excepciones.
// ═══════════════════════════════════════════════════════════════════════════

import { envPuesta } from '@/lib/env';
import { logger } from '@/lib/logger';
import { leerInterruptor, type LecturaInterruptor, type NombreInterruptor } from '../interruptores';
import type { DesgloseBitacora } from './desglose_contrato';
import {
  CONTRATO_MUESTRA_TMS, convertirBitacoraMuestra,
  type CodigoRevision, type MotivoRevision, type PadronOperadores, type ResultadoBitacoraMuestra,
} from './desglose_muestra_tms';
import type { ConfigCorreo, TipoExcepcion } from './repo_correo';

export const BANDERA_MUESTRA_TMS = 'LIKIDA_TMS_MUESTRA';
/** Única versión del sobre que se entiende hoy (SUPUESTO). */
export const VERSION_MUESTRA_TMS = 1;
export const MAX_BITACORAS_MUESTRA = 100;
/** Por bloque (Percepciones / Deducciones): el mismo tope del contrato interno. */
export const MAX_RENGLONES_BLOQUE_MUESTRA = 100;
/** `sistemaOrigen` con el que quedan marcadas las liquidaciones que entran por este formato. */
export const SISTEMA_ORIGEN_MUESTRA_TMS = 'tms-muestra-tms';

const CAMPOS_SOBRE = ['formato', 'version', 'bitacoras'];

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

// ── Interruptor ─────────────────────────────────────────────────────────────

export interface DepsHabilitacionMuestra {
  bandera: () => boolean;
  leer: (n: NombreInterruptor) => Promise<LecturaInterruptor>;
  leerConfig: (tenantId: string) => Promise<Pick<ConfigCorreo, 'activa' | 'canal'>>;
}

export function banderaMuestraTmsEncendida(): boolean {
  return envPuesta('LIKIDA_TMS_MUESTRA') && String(process.env.LIKIDA_TMS_MUESTRA).trim().toLowerCase() === 'si';
}

async function leerConfigPorOmision(tenantId: string): Promise<Pick<ConfigCorreo, 'activa' | 'canal'>> {
  const { leerConfigCorreo } = await import('./repo_correo');
  const l = await leerConfigCorreo(tenantId);
  if (!l.ok) throw new Error('configuración de envío no disponible');
  return l.valor;
}

const depsReales: DepsHabilitacionMuestra = { bandera: banderaMuestraTmsEncendida, leer: leerInterruptor, leerConfig: leerConfigPorOmision };

export type EstadoMuestra = { ok: true } | { ok: false; motivo: 'bandera_apagada' | 'interruptor_apagado' | 'envio_no_activo' };

/** ¿Esta flota puede recibir el formato `muestra-tms`? Por omisión NO. Todo error de lectura ⇒ apagado (falla cerrado). */
export async function muestraTmsHabilitada(tenantId: string, d: DepsHabilitacionMuestra = depsReales): Promise<EstadoMuestra> {
  if (!d.bandera()) return { ok: false, motivo: 'bandera_apagada' };
  try {
    for (const n of ['global', 'agente:liquidacion'] as const) if ((await d.leer(n)) !== 'encendido') return { ok: false, motivo: 'interruptor_apagado' };
    const c = await d.leerConfig(tenantId);
    if (c.activa !== true || c.canal !== 'correo') return { ok: false, motivo: 'envio_no_activo' };
  } catch (e) {
    logger.warn('liqmuestra.habilitacion_ilegible', { tenantId, tipo: e instanceof Error ? e.name : 'desconocido' });
    return { ok: false, motivo: 'interruptor_apagado' };
  }
  return { ok: true };
}

// ── Reconocer el formato ────────────────────────────────────────────────────

/**
 * ¿El cuerpo está escrito en el formato `muestra-tms`? Por su forma: trae `formato: "muestra-tms"` o es una bitácora suelta con
 * `BitacoraID`. El contrato interno nunca trae ninguna de las dos marcas.
 */
export function esFormatoMuestraTms(cuerpo: Record<string, unknown>): boolean {
  return cuerpo.formato === CONTRATO_MUESTRA_TMS || 'BitacoraID' in cuerpo;
}

// ── Preparar (validar y convertir) ──────────────────────────────────────────

export interface RevisionMuestra {
  /** Posición en el lote (0 = primera). */
  indice: number;
  /** `BitacoraID` como texto; `null` si no se pudo leer (entonces no hay clave bajo la cual abrir una excepción). */
  bitacora: string | null;
  motivos: MotivoRevision[];
}

export type PreparadoMuestra =
  | { ok: true; desgloses: DesgloseBitacora[]; revisiones: RevisionMuestra[] }
  | { ok: false; mensaje: string };

/** Valida el sobre y convierte cada bitácora. Nunca lanza por datos malos de una bitácora: la manda a revisión. */
export function prepararMuestraTms(cuerpo: Record<string, unknown>, padron: PadronOperadores | undefined): PreparadoMuestra {
  if ('desgloses' in cuerpo || 'correccion' in cuerpo) {
    return { ok: false, mensaje: 'El cuerpo mezcla el formato `muestra-tms` con el contrato interno de desgloses; manda uno solo.' };
  }
  let crudas: unknown[];
  if ('BitacoraID' in cuerpo) {
    if (cuerpo.formato !== undefined || 'bitacoras' in cuerpo || 'version' in cuerpo) {
      return { ok: false, mensaje: 'Una bitácora suelta no lleva `formato`, `version` ni `bitacoras`; usa el sobre completo.' };
    }
    crudas = [cuerpo];
  } else {
    const otros = Object.keys(cuerpo).filter((k) => !CAMPOS_SOBRE.includes(k));
    if (otros.length > 0) return { ok: false, mensaje: `El sobre trae campos que el contrato no tiene: ${otros.map((s) => `\`${s}\``).join(', ')}.` };
    if (cuerpo.version !== undefined && cuerpo.version !== VERSION_MUESTRA_TMS) {
      return { ok: false, mensaje: `Versión del formato no soportada; la única vigente es ${VERSION_MUESTRA_TMS}.` };
    }
    if (!Array.isArray(cuerpo.bitacoras)) return { ok: false, mensaje: '`bitacoras` tiene que ser una lista de bitácoras.' };
    crudas = cuerpo.bitacoras;
  }
  if (crudas.length === 0) return { ok: false, mensaje: '`bitacoras` no puede venir vacía.' };
  if (crudas.length > MAX_BITACORAS_MUESTRA) {
    return { ok: false, mensaje: `Máximo ${MAX_BITACORAS_MUESTRA} bitácoras por petición (mandaste ${crudas.length}); manda el resto en otra petición.` };
  }
  for (let i = 0; i < crudas.length; i++) {
    const f = crudas[i];
    if (!esObjeto(f)) continue; // una fila que no es objeto va a revisión, no tumba el lote
    for (const bloque of ['Percepciones', 'Deducciones'] as const) {
      const lista = f[bloque];
      if (Array.isArray(lista) && lista.length > MAX_RENGLONES_BLOQUE_MUESTRA) {
        return { ok: false, mensaje: `bitacoras[${i}].${bloque} no puede traer más de ${MAX_RENGLONES_BLOQUE_MUESTRA} renglones.` };
      }
    }
  }

  const resultados: ResultadoBitacoraMuestra[] = crudas.map((f) => convertirBitacoraMuestra(f, { ...(padron ? { padron } : {}) }));

  // BitacoraID repetida en el lote: ambas a revisión.
  const veces = new Map<string, number>();
  for (const r of resultados) if (r.bitacoraId !== '') veces.set(r.bitacoraId, (veces.get(r.bitacoraId) ?? 0) + 1);

  const desgloses: DesgloseBitacora[] = [];
  const revisiones: RevisionMuestra[] = [];
  resultados.forEach((r, indice) => {
    const motivos = [...r.revision];
    if (r.bitacoraId !== '' && (veces.get(r.bitacoraId) ?? 0) > 1) {
      motivos.push({ codigo: 'bitacora_repetida', campo: 'BitacoraID', detalle: 'La misma bitácora viene más de una vez en el lote; no se adivina cuál vale.' });
    }
    if (motivos.length === 0 && r.desglose !== null) desgloses.push(r.desglose);
    else revisiones.push({ indice, bitacora: r.bitacoraId === '' ? null : r.bitacoraId, motivos });
  });
  return { ok: true, desgloses, revisiones };
}

// ── Registrar las revisiones en la bandeja de excepciones existente ─────────

const CODIGOS_OPERADOR: ReadonlySet<CodigoRevision> = new Set<CodigoRevision>([
  'operador_vacio', 'operador_sin_padron', 'operador_no_encontrado', 'operador_homonimo', 'operador_sin_numero',
]);

/** Motivo (`detalle.motivo`) que entiende el panel para «operador sin alta». Homonimia es `nombre_ambiguo`; todo lo demás, `nombre_sin_alta`. */
export function motivoOperadorDe(codigo: CodigoRevision): 'nombre_ambiguo' | 'nombre_sin_alta' {
  return codigo === 'operador_homonimo' ? 'nombre_ambiguo' : 'nombre_sin_alta';
}

export interface DepsRegistroRevision {
  abrirExcepcion: (
    tenantId: string, claveExterna: string, tipo: TipoExcepcion, detalle: Record<string, unknown>, ahora: Date,
  ) => Promise<{ id: number; nueva: boolean }>;
  ahora: () => Date;
}

/**
 * Abre (idempotente) una excepción por bitácora y tipo. Solo las que tienen `BitacoraID` legible: sin él no hay clave. Devuelve cuántas
 * quedaron registradas. En el detalle: bitácora, motivo y NOMBRE DEL CAMPO; jamás el nombre del operador ni valores.
 */
export async function registrarRevisionesMuestra(
  tenantId: string, revisiones: readonly RevisionMuestra[], claveDe: (bitacora: string) => string, d: DepsRegistroRevision,
): Promise<number> {
  let n = 0;
  for (const rev of revisiones) {
    if (rev.bitacora === null) continue;
    const clave = claveDe(rev.bitacora);
    const operador = rev.motivos.filter((m) => CODIGOS_OPERADOR.has(m.codigo));
    const otros = rev.motivos.filter((m) => !CODIGOS_OPERADOR.has(m.codigo));
    if (operador.length > 0) {
      const motivo = operador.some((m) => m.codigo === 'operador_homonimo') ? 'nombre_ambiguo' : motivoOperadorDe(operador[0].codigo);
      await d.abrirExcepcion(tenantId, clave, 'operador_no_encontrado', { bitacora: rev.bitacora, motivo, origen: CONTRATO_MUESTRA_TMS }, d.ahora());
      n += 1;
    }
    if (otros.length > 0) {
      await d.abrirExcepcion(tenantId, clave, 'mapeo_invalido', {
        bitacora: rev.bitacora, origen: CONTRATO_MUESTRA_TMS, campos: [...new Set(otros.map((m) => m.campo))].slice(0, 20),
      }, d.ahora());
      n += 1;
    }
  }
  return n;
}

export interface DepsCierreRevision {
  resolverExcepciones: (tenantId: string, claveExterna: string, tipo: TipoExcepcion, ahora: Date) => Promise<number>;
  ahora: () => Date;
}

/**
 * Una bitácora corregida que ahora SÍ pasó la validación (sin revisión) cierra las excepciones de revisión que abrió su entrega
 * anterior bajo la misma clave. Un fallo al cerrar no tumba la recepción (la bitácora ya entró): se devuelve cuántas se cerraron.
 */
export async function cerrarRevisionesResueltas(
  tenantId: string, claves: readonly string[], d: DepsCierreRevision,
): Promise<number> {
  let n = 0;
  for (const clave of claves) {
    for (const tipo of ['operador_no_encontrado', 'mapeo_invalido'] as const) {
      try { n += await d.resolverExcepciones(tenantId, clave, tipo, d.ahora()); } catch { /* no bloquea; la excepción queda abierta */ }
    }
  }
  return n;
}

/** Lo que la respuesta de la ruta cuenta de cada revisión: índice, bitácora y motivos genéricos (sin valores personales). */
export function resumenRevisiones(revisiones: readonly RevisionMuestra[]): Array<{ indice: number; bitacora: string | null; motivos: Array<{ codigo: CodigoRevision; campo: string }> }> {
  return revisiones.map((r) => ({ indice: r.indice, bitacora: r.bitacora, motivos: r.motivos.map((m) => ({ codigo: m.codigo, campo: m.campo })) }));
}
