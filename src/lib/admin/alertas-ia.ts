import { logger } from '@/lib/logger';
import { modelFor, type ModelRole } from '@/lib/llm/models';
import { tocaGobiernoIa } from '@/lib/llm/gobierno';

// ═══════════════════════════════════════════════════════════════════════════
// ALERTAS DE IA EMPUJADAS DESDE LA GUARDIA DE 5 MINUTOS (F16 · sin cron nuevo).
//
//  1. «IA sin registro»: no hubo ni una fila en `llm_costo` en las últimas N horas y hay viajes abiertos. El 15-oct al
//     7-nov la IA estuvo caída y solo se vio en un panel que nadie abrió; esto lo empuja a la campana y al correo.
//  2. «Tasa de respaldo alta»: de las llamadas de la última hora a los roles OCR, cuadre y chat, el porcentaje que NO
//     corrió en el modelo primario del rol (cayó al respaldo entre proveedores). Más de 5 % con muestra mínima de 20
//     alerta; con menos de 20 llamadas dice «sin medir» y NO alerta (un 1 de 3 no es una tasa).
//
// Todo lo evaluativo es PURO (se prueba con series sintéticas). Lo que no se pudo leer viaja como `null` y la
// evaluación dice `sin_medir`: jamás «todo bien». APAGADO por omisión (ALERTAS_IA_GUARDIA=encendido): los umbrales
// (N horas, 5 %, 20 llamadas) son los propuestos y los confirma el dueño antes de encender (ver docs/operacion/banderas.md).
// ═══════════════════════════════════════════════════════════════════════════

export const HORAS_SIN_REGISTRO_IA = 12;
export const UMBRAL_TASA_RESPALDO = 0.05;
export const MUESTRA_MINIMA_RESPALDO = 20;
export const VENTANA_RESPALDO_HORAS = 1;
/** Un viaje abierto hace más que esto es un viaje olvidado, no actividad esperada de IA. */
export const DIAS_VIAJE_ABIERTO_VIGENTE = 14;
/** Qué fase de `llm_costo` corresponde a qué rol de modelo (el primario contra el que se mide el respaldo). */
export const ROL_DE_FASE: Readonly<Record<string, ModelRole>> = { ocr: 'ocr', cuadre: 'cuadre', chat: 'chat' };

export function alertasIaEncendidas(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ALERTAS_IA_GUARDIA === 'encendido';
}

export type EstadoAlertaIa = 'ok' | 'alerta' | 'sin_medir';

export interface EvaluacionSinRegistro { estado: EstadoAlertaIa; horas: number; viajesAbiertos: number | null; filas: number | null }

/** PURA. `filas`/`viajesAbiertos` = `null` es «no se pudo leer». */
export function evaluarIaSinRegistro(e: { filasEnVentana: number | null; viajesAbiertos: number | null; horas?: number }): EvaluacionSinRegistro {
  const horas = e.horas ?? HORAS_SIN_REGISTRO_IA;
  const base = { horas, viajesAbiertos: e.viajesAbiertos, filas: e.filasEnVentana };
  if (e.filasEnVentana === null || e.viajesAbiertos === null) return { ...base, estado: 'sin_medir' };
  // Con filas, la IA registró: no hay nada que avisar. Sin viajes abiertos, que no haya filas es lo esperado.
  if (e.filasEnVentana > 0 || e.viajesAbiertos === 0) return { ...base, estado: 'ok' };
  return { ...base, estado: 'alerta' };
}

export interface EvaluacionRespaldo { estado: EstadoAlertaIa; tasa: number | null; muestra: number; enRespaldo: number; porFase: Record<string, { muestra: number; enRespaldo: number }> }

/** PURA. `primarioDeFase` devuelve el modelo primario vigente de la fase o `null` si la fase no se mide. */
export function evaluarTasaRespaldo(
  filas: ReadonlyArray<{ fase: string; modelo: string }> | null,
  primarioDeFase: (fase: string) => string | null,
  opts: { umbral?: number; minimo?: number } = {},
): EvaluacionRespaldo {
  const umbral = opts.umbral ?? UMBRAL_TASA_RESPALDO;
  const minimo = opts.minimo ?? MUESTRA_MINIMA_RESPALDO;
  if (filas === null) return { estado: 'sin_medir', tasa: null, muestra: 0, enRespaldo: 0, porFase: {} };
  const porFase: EvaluacionRespaldo['porFase'] = {};
  let muestra = 0; let enRespaldo = 0;
  for (const f of filas) {
    const primario = primarioDeFase(f.fase);
    if (primario === null) continue;
    const p = (porFase[f.fase] ??= { muestra: 0, enRespaldo: 0 });
    p.muestra++; muestra++;
    if (f.modelo !== primario) { p.enRespaldo++; enRespaldo++; }
  }
  if (muestra < minimo) return { estado: 'sin_medir', tasa: null, muestra, enRespaldo, porFase };
  const tasa = enRespaldo / muestra;
  return { estado: tasa > umbral ? 'alerta' : 'ok', tasa, muestra, enRespaldo, porFase };
}

export function primarioVigenteDeFase(fase: string): string | null {
  const rol = ROL_DE_FASE[fase];
  return rol ? modelFor(rol) : null;
}

export interface SenalesIa { filasEnVentana: number | null; viajesAbiertos: number | null; filasRespaldo: Array<{ fase: string; modelo: string }> | null }

/** Lee de la base lo mínimo. Cada lectura falla POR VALOR (`null`), nunca lanza. */
export async function leerSenalesIa(ahoraMs: number): Promise<SenalesIa> {
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const db = supabaseAdmin();
  const hace = (ms: number) => new Date(ahoraMs - ms).toISOString();
  const H = 3_600_000;
  const seguro = async <T>(f: () => PromiseLike<{ data?: T | null; count?: number | null; error: { message: string } | null }>): Promise<{ data: T | null; count: number | null }> => {
    try {
      const r = await f();
      if (r.error) { logger.warn('alertas_ia.lectura_fallo', { err: r.error.message }); return { data: null, count: null }; }
      return { data: r.data ?? null, count: r.count ?? null };
    } catch (e) {
      logger.warn('alertas_ia.lectura_fallo', { err: e instanceof Error ? e.message : String(e) });
      return { data: null, count: null };
    }
  };
  const [filas, viajes, respaldo] = await Promise.all([
    seguro(() => db.from('llm_costo').select('id', { count: 'exact', head: true }).gte('created_at', hace(HORAS_SIN_REGISTRO_IA * H))),
    seguro(() => db.from('viaje').select('id', { count: 'exact', head: true }).in('estatus', ['abierto', 'en_cuadre']).gte('created_at', hace(DIAS_VIAJE_ABIERTO_VIGENTE * 24 * H))),
    seguro<Array<{ fase: string; modelo: string }>>(() => db.from('llm_costo').select('fase, modelo').in('fase', Object.keys(ROL_DE_FASE)).gte('created_at', hace(VENTANA_RESPALDO_HORAS * H)).limit(5000)),
  ]);
  return { filasEnVentana: filas.count, viajesAbiertos: viajes.count, filasRespaldo: respaldo.data };
}

/** Lo que la campana y el latido guardan de la última pasada. */
export interface DetalleAlertasIa {
  evaluadoEn: string;
  sinRegistro: EvaluacionSinRegistro;
  respaldo: EvaluacionRespaldo;
}

export interface ResultadoAlertasIa {
  estado: 'apagado' | 'omitido' | 'ok' | 'error';
  detalle?: DetalleAlertasIa;
  avisos?: string[];
  error?: string;
}

export interface DepsAlertasIa {
  leer?: (ahoraMs: number) => Promise<SenalesIa>;
  avisar?: (evento: string, detalle: Record<string, unknown>) => Promise<boolean>;
  primarioDeFase?: (fase: string) => string | null;
  env?: NodeJS.ProcessEnv;
}

/**
 * Una pasada. Cada 15 minutos (una de cada tres pasadas de la guardia). Avisa solo al ENTRAR en alerta (`previo` = lo
 * guardado en el latido anterior): una IA caída tres horas no manda un correo por pasada; el piso por evento de
 * `alertarOperador` es la segunda red. La campana lee el `detalle` del latido, así que se ve mientras dure.
 * NUNCA lanza.
 */
export async function correrAlertasIa(ahoraMs: number, previo: DetalleAlertasIa | null, deps: DepsAlertasIa = {}): Promise<ResultadoAlertasIa> {
  const env = deps.env ?? process.env;
  if (!alertasIaEncendidas(env)) return { estado: 'apagado' };
  if (!tocaGobiernoIa(ahoraMs)) return { estado: 'omitido' };
  try {
    const leer = deps.leer ?? leerSenalesIa;
    const avisar = deps.avisar ?? (async (evento, detalle) => (await import('@/lib/observability/alerta')).alertarOperador(evento, detalle));
    const s = await leer(ahoraMs);
    const sinRegistro = evaluarIaSinRegistro({ filasEnVentana: s.filasEnVentana, viajesAbiertos: s.viajesAbiertos });
    const respaldo = evaluarTasaRespaldo(s.filasRespaldo, deps.primarioDeFase ?? primarioVigenteDeFase);
    const detalle: DetalleAlertasIa = { evaluadoEn: new Date(ahoraMs).toISOString(), sinRegistro, respaldo };
    const avisos: string[] = [];
    if (sinRegistro.estado === 'alerta' && previo?.sinRegistro.estado !== 'alerta') {
      const ok = await avisar('guardia.ia_sin_registro', {
        codigo: 'ia_sin_registro',
        error: `Ni una llamada de IA registrada en las últimas ${sinRegistro.horas} h y hay ${sinRegistro.viajesAbiertos} viaje(s) abierto(s): la IA puede estar caída o el registro de costo roto.`,
      });
      avisos.push(ok ? 'ia_sin_registro' : 'ia_sin_registro_no_salio');
    }
    if (respaldo.estado === 'alerta' && previo?.respaldo.estado !== 'alerta') {
      const pct = Math.round((respaldo.tasa ?? 0) * 1000) / 10;
      const ok = await avisar('guardia.ia_respaldo_alto', {
        codigo: 'ia_respaldo_alto',
        error: `${pct} % de las ${respaldo.muestra} llamadas de la última hora corrieron en el modelo de respaldo (umbral ${UMBRAL_TASA_RESPALDO * 100} %): el primario puede estar fallando.`,
      });
      avisos.push(ok ? 'ia_respaldo_alto' : 'ia_respaldo_alto_no_salio');
    }
    return { estado: 'ok', detalle, avisos };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 160);
    logger.error('cron.guardia.alertas_ia_fallo', { err: error });
    return { estado: 'error', error };
  }
}

/** Lee el `detalle.alertasIa` de un latido sin confiar en su forma. */
export function alertasIaDeDetalle(detalle: unknown): DetalleAlertasIa | null {
  const a = (detalle as { alertasIa?: unknown } | null)?.alertasIa as Partial<DetalleAlertasIa> | undefined;
  if (!a || typeof a !== 'object' || !a.sinRegistro || !a.respaldo) return null;
  const ok = (e: unknown): e is { estado: EstadoAlertaIa } => ['ok', 'alerta', 'sin_medir'].includes((e as { estado?: string })?.estado ?? '');
  if (!ok(a.sinRegistro) || !ok(a.respaldo)) return null;
  return a as DetalleAlertasIa;
}
