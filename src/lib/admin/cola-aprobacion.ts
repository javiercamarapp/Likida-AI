// ═══════════════════════════════════════════════════════════════════════════
// VACIAR LA COLA DE APROBACIÓN POR LOTES (auditoría admin, 10-nov-2026, P0).
//
// El hallazgo: ~100 piezas `pendiente` en `cola_aprobacion`, la más vieja de
// agosto, la última creada el 2-sep. Eran 100 formularios de uno en uno, y
// esa bandeja llena activa la contrapresión del runner (`topeBandejaGlobal`),
// que frena a 48 de 49 agentes. No existía ninguna acción masiva.
//
// Este módulo SOLO construye la acción; no se ejecuta contra producción desde
// aquí. Tres reglas que no se negocian:
//
//  1. DRY-RUN POR OMISIÓN. `vaciarVencidas` cuenta y NO escribe salvo que se
//     le pase `dryRun: false` a propósito. Contar antes de actuar.
//  2. LÍMITE POR LOTE. Una sola llamada toca como máximo `limite` piezas
//     (50 por omisión, tope duro 200), las MÁS VIEJAS primero: un clic
//     equivocado no vacía la bandeja entera.
//  3. SE FIRMA. Cada lote deja UNA entrada en `bitacora_auditoria` con quién,
//     cuántas, el corte y los ids; y cada pieza queda `rechazado` con un
//     motivo que dice que fue por vencimiento (el CHECK `cola_rechazo_con_
//     motivo` de la 0117 exige motivo). No se inventa un estado nuevo: el
//     dominio de `cola_aprobacion.estado` es pendiente|aprobado|rechazado.
//
// NO suelta ni cambia el tope del runner: vaciar la bandeja es lo que lo
// destraba de forma legítima, no subir el número.
//
// Falla cerrado: sin poder leer o sin confirmar al actor como superadmin, no
// se escribe nada y el error se DICE (supabase-js reporta por valor).
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { traerTodo, conteo } from '@/lib/likida/pg';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { DatoInvalido } from '@/lib/likida/errores';
import { logger } from '@/lib/logger';
import { diasVencimientoPieza, motivoBandejaGlobalSinAtender, topeBandejaGlobal } from '@/lib/likida/agentes/runner';

/** Días de espera a partir de los cuales una pieza pendiente está vencida. */
export const DIAS_VENCIDA_POR_OMISION = 30;
export const DIAS_VENCIDA_MIN = 1;
export const DIAS_VENCIDA_MAX = 365;
/** Piezas por lote, por omisión y tope duro. */
export const LIMITE_LOTE_POR_OMISION = 50;
export const LIMITE_LOTE_MAX = 200;

export interface ParametrosVencidas {
  /** Más de N días en `pendiente`. Por omisión 30. */
  dias?: number;
  /** Máximo de piezas que esta llamada resuelve. Por omisión 50, tope 200. */
  limite?: number;
  /** Si se da, solo esos tipos de pieza (p. ej. los partes informativos). */
  tipos?: readonly string[];
}

export interface ParametrosNormalizados {
  dias: number;
  limite: number;
  tipos: string[] | null;
}

const TIPO_RE = /^[a-z0-9_]{2,40}$/;

/** Valida y completa los parámetros. LANZA `DatoInvalido` con texto de
 *  pantalla: un parámetro absurdo (0 días, -5, "abc") no se arregla en
 *  silencio, porque «0 días» vaciaría TODA la bandeja. Pura. */
export function normalizarParametros(p: ParametrosVencidas = {}): ParametrosNormalizados {
  const dias = p.dias ?? DIAS_VENCIDA_POR_OMISION;
  if (!Number.isInteger(dias) || dias < DIAS_VENCIDA_MIN || dias > DIAS_VENCIDA_MAX) {
    throw new DatoInvalido(`Los días de vencimiento van de ${DIAS_VENCIDA_MIN} a ${DIAS_VENCIDA_MAX} (entero).`);
  }
  const limite = p.limite ?? LIMITE_LOTE_POR_OMISION;
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_LOTE_MAX) {
    throw new DatoInvalido(`El límite por lote va de 1 a ${LIMITE_LOTE_MAX} (entero).`);
  }
  let tipos: string[] | null = null;
  if (p.tipos !== undefined) {
    if (p.tipos.length === 0) throw new DatoInvalido('Si filtras por tipo, indica al menos uno.');
    for (const t of p.tipos) {
      if (!TIPO_RE.test(t)) throw new DatoInvalido(`El tipo de pieza "${t.slice(0, 40)}" no es válido.`);
    }
    tipos = [...new Set(p.tipos)];
  }
  return { dias, limite, tipos };
}

/** El instante de corte: lo creado ANTES de esto lleva más de `dias` días. Pura. */
export function corteDeVencimiento(ahoraMs: number, dias: number): string {
  return new Date(ahoraMs - dias * 86_400_000).toISOString();
}

/** El motivo que queda en cada pieza resuelta por vencimiento. Pura. */
export function motivoDeVencimiento(dias: number): string {
  return `Archivada por vencimiento: más de ${dias} días sin atender en la bandeja (limpieza por lote; no fue una decisión sobre el contenido).`;
}

export interface ResumenVencidas {
  /** El corte aplicado (ISO): lo creado antes de esto está vencido. */
  corte: string;
  dias: number;
  /** Cuántas pendientes vencidas hay EN TOTAL (puede ser más que el lote). */
  vencidas: number;
  /** Cuántas tocaría esta llamada (min(vencidas, limite)). */
  enElLote: number;
  limite: number;
  porTipo: Record<string, number>;
  porAgente: Record<string, number>;
  /** `creado_en` de la más vieja vencida, o `null` si no hay. */
  masViejaCreadaEn: string | null;
}

interface FilaVencida { id: string; tipo: string; agente: string; creado_en: string }

/** Agrupa las filas vencidas. Pura (probable sin base). */
export function resumirVencidas(
  filas: ReadonlyArray<FilaVencida>,
  corte: string,
  dias: number,
  limite: number,
): ResumenVencidas {
  const porTipo: Record<string, number> = {};
  const porAgente: Record<string, number> = {};
  let masVieja: string | null = null;
  for (const f of filas) {
    porTipo[f.tipo] = (porTipo[f.tipo] ?? 0) + 1;
    porAgente[f.agente] = (porAgente[f.agente] ?? 0) + 1;
    if (masVieja === null || f.creado_en < masVieja) masVieja = f.creado_en;
  }
  return {
    corte, dias, vencidas: filas.length, enElLote: Math.min(filas.length, limite), limite,
    porTipo, porAgente, masViejaCreadaEn: masVieja,
  };
}

/** Las pendientes vencidas, TODAS (paginadas), más viejas primero. LANZA ante
 *  error: «0 vencidas» por base caída afirmaría que la bandeja está al día. */
async function leerVencidas(corte: string, tipos: string[] | null): Promise<FilaVencida[]> {
  return traerTodo<FilaVencida>(
    (d, h) => {
      let q = supabaseAdmin()
        .from('cola_aprobacion')
        .select('id, tipo, agente, creado_en', conteo(d))
        .eq('estado', 'pendiente')
        .lt('creado_en', corte);
      if (tipos) q = q.in('tipo', tipos);
      return acotada(q.order('creado_en', { ascending: true }).order('id', { ascending: true }).range(d, h), 'colaAprobacion.vencidas');
    },
    'colaAprobacion.vencidas',
  );
}

/** El DRY-RUN: cuenta y desglosa lo que un lote resolvería. NO escribe. LANZA ante error. */
export async function contarVencidas(
  params: ParametrosVencidas = {},
  ahoraMs: number = Date.now(),
): Promise<ResumenVencidas> {
  const p = normalizarParametros(params);
  const corte = corteDeVencimiento(ahoraMs, p.dias);
  return resumirVencidas(await leerVencidas(corte, p.tipos), corte, p.dias, p.limite);
}

export interface ResultadoLote extends ResumenVencidas {
  /** `true` = solo se contó; no se tocó ninguna pieza. */
  dryRun: boolean;
  /** Cuántas piezas se resolvieron DE VERDAD (0 en dry-run). */
  resueltas: number;
  /** Ids de las resueltas (vacío en dry-run). */
  ids: string[];
  /** Cuántas vencidas siguen pendientes tras este lote. */
  restantes: number;
  /** `false` si la bitácora del lote no pudo escribirse (el lote SÍ se hizo; se dice). */
  bitacoraEscrita: boolean | null;
}

/** Confirma que el actor es un superadmin vigente. Falla cerrado. */
async function exigirSuperadmin(actorId: string): Promise<string> {
  if (!actorId) throw new DatoInvalido('No se pudo confirmar quién resuelve — recarga y vuelve a intentar.');
  const { data, error } = await acotada(
    supabaseAdmin().from('app_user').select('email, rol').eq('id', actorId).maybeSingle(),
    'colaAprobacion.actor',
  );
  if (error) throw new Error(`colaAprobacion.actor: ${error.message}`);
  const f = data as { email?: string; rol?: string } | null;
  if (!f || f.rol !== 'superadmin' || !f.email) {
    throw new DatoInvalido('Solo un superadmin puede resolver piezas por lote.');
  }
  return f.email;
}

/**
 * Resuelve (rechaza como «archivada por vencimiento») las pendientes vencidas,
 * por LOTE y empezando por las más viejas. `dryRun` es `true` por omisión.
 *
 * El UPDATE va anclado a `estado = 'pendiente'` y a los ids leídos: si otra
 * sesión resolvió una entre la lectura y la escritura, esa fila no se toca y
 * `resueltas` lo refleja (no se pisa una resolución ajena).
 */
export async function vaciarVencidas(
  actorId: string,
  params: ParametrosVencidas & { dryRun?: boolean } = {},
  ahoraMs: number = Date.now(),
): Promise<ResultadoLote> {
  const dryRun = params.dryRun !== false;
  const p = normalizarParametros(params);
  const corte = corteDeVencimiento(ahoraMs, p.dias);
  const filas = await leerVencidas(corte, p.tipos);
  const resumen = resumirVencidas(filas, corte, p.dias, p.limite);

  if (dryRun) {
    return { ...resumen, dryRun: true, resueltas: 0, ids: [], restantes: resumen.vencidas, bitacoraEscrita: null };
  }
  if (filas.length === 0) {
    return { ...resumen, dryRun: false, resueltas: 0, ids: [], restantes: 0, bitacoraEscrita: null };
  }

  const email = await exigirSuperadmin(actorId);
  const lote = filas.slice(0, p.limite).map((f) => f.id);
  const motivo = motivoDeVencimiento(p.dias);
  const { data, error } = await acotada(
    supabaseAdmin()
      .from('cola_aprobacion')
      .update({
        estado: 'rechazado',
        motivo_rechazo: motivo,
        resuelto_por: actorId,
        resuelto_por_email: email,
        resuelto_en: new Date(ahoraMs).toISOString(),
      })
      .in('id', lote)
      .eq('estado', 'pendiente')
      .select('id'),
    'colaAprobacion.vaciar',
  );
  if (error) throw new Error(`colaAprobacion.vaciar: ${error.message}`);
  const ids = Array.isArray(data) ? (data as Array<{ id: string }>).map((x) => x.id) : [];

  const bitacoraEscrita = await anotarBitacora(
    {
      tenantId: null,
      actor: { id: actorId, email },
      accion: 'cola.vencidas_archivadas',
      entidad: 'cola_aprobacion',
      entidadId: `lote:${new Date(ahoraMs).toISOString()}`,
      detalle: {
        dias: p.dias, corte, limite: p.limite, tipos: p.tipos,
        resueltas: ids.length, vencidasAntes: resumen.vencidas,
        porTipo: resumen.porTipo, ids,
      },
    },
    { evento: 'cola.bitacora_lote_no_escribio', contexto: { resueltas: ids.length } },
  );

  return {
    ...resumen, dryRun: false, resueltas: ids.length, ids,
    restantes: Math.max(0, resumen.vencidas - ids.length), bitacoraEscrita,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EL ESTADO DE LA BANDEJA — lo que el dueño necesita ver ANTES de vaciarla y
// lo que alimenta los números de las pestañas (Tu turno / Aprobaciones).
//
// Tres lecturas baratas (dos conteos y la fila más vieja), NO la bandeja
// entera: se evalúa en cada navegación del admin. `null` = no se pudo leer;
// nunca un 0 que diga «la bandeja está al día». La regla del freno es la MISMA
// función pura del runner (`motivoBandejaGlobalSinAtender`), no una copia: si
// el tope cambia allá, aquí cambia solo.
// ═══════════════════════════════════════════════════════════════════════════

export interface ResumenBandejaCola {
  pendientes: number;
  urgentes: number;
  /** `creado_en` de la pendiente más vieja, o `null` si no hay ninguna. */
  masViejaCreadaEn: string | null;
  /** Días que lleva esperando la más vieja (reloj inyectado), o `null` si no hay. */
  diasMasVieja: number | null;
  /** ¿El runner está frenando a los agentes por esta bandeja? Misma regla que `runner.ts`. */
  frenaAlRunner: boolean;
  /** El motivo exacto del freno (el que el runner deja en el latido), o `null` si no frena. */
  motivoFreno: string | null;
  topeBandeja: number;
  diasVencimiento: number;
}

/** Pura. Arma el resumen con los tres datos leídos. */
export function armarResumenBandeja(
  pendientes: number,
  urgentes: number,
  masViejaCreadaEn: string | null,
  ahoraMs: number,
): ResumenBandejaCola {
  const motivoFreno = motivoBandejaGlobalSinAtender(pendientes, masViejaCreadaEn, ahoraMs);
  return {
    pendientes, urgentes, masViejaCreadaEn,
    diasMasVieja: masViejaCreadaEn === null ? null : Math.max(0, (ahoraMs - Date.parse(masViejaCreadaEn)) / 86_400_000),
    frenaAlRunner: motivoFreno !== null, motivoFreno,
    topeBandeja: topeBandejaGlobal(), diasVencimiento: diasVencimientoPieza(),
  };
}

async function contarPendientes(prioridad: 'urgente' | null): Promise<number> {
  let q = supabaseAdmin().from('cola_aprobacion').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente');
  if (prioridad) q = q.eq('prioridad', prioridad);
  const { count, error } = await acotada(q, `colaAprobacion.conteo/${prioridad ?? 'todas'}`);
  if (error) throw new Error(`colaAprobacion.conteo: ${error.message}`);
  if (typeof count !== 'number') throw new Error('colaAprobacion.conteo: la base no devolvió el conteo');
  return count;
}

async function leerMasVieja(): Promise<string | null> {
  const { data, error } = await acotada(
    supabaseAdmin().from('cola_aprobacion').select('creado_en').eq('estado', 'pendiente')
      .order('creado_en', { ascending: true }).order('id', { ascending: true }).limit(1),
    'colaAprobacion.masVieja',
  );
  if (error) throw new Error(`colaAprobacion.masVieja: ${error.message}`);
  return ((data ?? [])[0] as { creado_en?: string } | undefined)?.creado_en ?? null;
}

/** NUNCA lanza: `null` = no se pudo saber (se dice «sin dato», no «0 pendientes»). */
export async function leerResumenBandeja(ahoraMs: number = Date.now()): Promise<ResumenBandejaCola | null> {
  try {
    // Las tres son funciones async: un fallo síncrono (p. ej. sin llave) cae como rechazo manejado por Promise.all, no suelto.
    const [pendientes, urgentes, masVieja] = await Promise.all([contarPendientes(null), contarPendientes('urgente'), leerMasVieja()]);
    return armarResumenBandeja(pendientes, urgentes, masVieja, ahoraMs);
  } catch (e) {
    logger.warn('cola_aprobacion.resumen_sin_dato', { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
