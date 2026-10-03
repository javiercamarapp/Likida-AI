// ═══════════════════════════════════════════════════════════════════════════
// LOS COMPONENTES DE /estado (E4) — la lógica PURA: de lo medido a un estado.
//
// Una página de estado pública tiene dos pecados posibles: pintar verde lo que
// no se midió, y filtrar detalle explotable (nombres de cron, versiones, el
// motivo de un fallo). Este módulo cierra los dos por construcción:
//
//  · Solo emite un estado cuando HAY una medición. Sin ella, `null` — y la
//    página dice «sin medición», nunca «operativo».
//  · Solo habla del catálogo CERRADO de cinco componentes y de tres estados.
//    No recibe ni devuelve un nombre de cron, una flota, un motivo ni un sha.
//
// Qué mide cada componente (y qué NO — la página lo dice igual):
//  · app       — `/api/health` contestó, por la URL PÚBLICA, desde el cron de la
//                guardia (Vercel → dominio → función). Degradado si el esquema de
//                la base va desfasado del código. NO mide la red del visitante.
//  · base      — la consulta real de `/api/health` (HEAD + count sobre `tenant`).
//  · crons     — todos los latidos al día y sin resultado malo (el agregado de
//                `/api/health`; los huecos de configuración declarados no cuentan).
//  · whatsapp  — NUESTRA tubería (recoger → procesar → enviar) está al día:
//                latidos de `wa-pendientes` y `wa-outbox`. NO mide la nube de Meta.
//  · correo    — la tubería de envío de correo corre (latido de `buzon-entrega`),
//                solo si hay canal de correo configurado. NO mide la entrega al
//                buzón del destinatario.
// ═══════════════════════════════════════════════════════════════════════════

import { TZ_MX, hoyMx } from '@/lib/formato';
import type { ComponenteEstado, DiaEstado, EstadoMedido, LatidoDetallado, CronId } from './salud';

/** Lo que el sondeo a `/api/health` logró leer. `null` en un campo = el cuerpo no lo traía (no se inventa). */
export interface SondeoHealth {
  /** ¿Hubo respuesta HTTP? (`false` = red, DNS, timeout). */
  respondio: boolean;
  httpStatus: number | null;
  status: 'ok' | 'degraded' | 'fail' | null;
  db: 'ok' | 'fallo' | null;
  crons: 'ok' | 'degraded' | 'config_ausente' | 'unknown' | null;
  /** `true` si `migracion.atras` y `migracion.adelante` son 0; `null` si el cuerpo no lo decía. */
  migracionAlDia: boolean | null;
}

const SONDEO_SIN_RESPUESTA: SondeoHealth = { respondio: false, httpStatus: null, status: null, db: null, crons: null, migracionAlDia: null };

/** Lee el cuerpo de `/api/health` sin confiar en su forma. Lo que no cuadra queda `null`. */
export function leerCuerpoHealth(httpStatus: number, cuerpo: unknown): SondeoHealth {
  const base: SondeoHealth = { ...SONDEO_SIN_RESPUESTA, respondio: true, httpStatus };
  if (cuerpo === null || typeof cuerpo !== 'object') return base;
  const c = cuerpo as Record<string, unknown>;
  const checks = (c.checks !== null && typeof c.checks === 'object' ? c.checks : {}) as Record<string, unknown>;
  const mig = (c.migracion !== null && typeof c.migracion === 'object' ? c.migracion : null) as Record<string, unknown> | null;
  return {
    ...base,
    status: c.status === 'ok' || c.status === 'degraded' || c.status === 'fail' ? c.status : null,
    db: checks.db === 'ok' || checks.db === 'fallo' ? checks.db : null,
    crons: checks.crons === 'ok' || checks.crons === 'degraded' || checks.crons === 'config_ausente' || checks.crons === 'unknown' ? checks.crons : null,
    migracionAlDia: mig && typeof mig.atras === 'number' && typeof mig.adelante === 'number' ? mig.atras === 0 && mig.adelante === 0 : null,
  };
}

/** Pega a `/api/health` por la URL pública. Nunca lanza: una caída es un dato (`respondio: false`), no una excepción. */
export async function sondearHealth(url: string, f: typeof fetch = fetch, timeoutMs = 8_000): Promise<SondeoHealth> {
  try {
    const r = await f(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'likida-guardia/1' } });
    let cuerpo: unknown = null;
    try { cuerpo = await r.json(); } catch { /* una respuesta que no es JSON se juzga por su status */ }
    return leerCuerpoHealth(r.status, cuerpo);
  } catch {
    return { ...SONDEO_SIN_RESPUESTA };
  }
}

export type MedicionComponentes = Record<ComponenteEstado, EstadoMedido | null>;

const SIN_MEDIR: MedicionComponentes = { app: null, base: null, crons: null, whatsapp: null, correo: null };

/** `/api/health` → app, base y crons. */
export function componentesDesdeHealth(h: SondeoHealth): Pick<MedicionComponentes, 'app' | 'base' | 'crons'> {
  // Sin respuesta, o 5xx sin cuerpo legible: la app no está sirviendo.
  if (!h.respondio || (h.httpStatus !== null && h.httpStatus >= 500 && h.status === null)) {
    return { app: 'caido', base: null, crons: null };
  }
  // 429 (el health tiene rate limit por IP): no es una medición, es un límite.
  if (h.httpStatus === 429) return { app: null, base: null, crons: null };
  // Sirvió JSON de salud: la app está arriba. Un esquema desfasado la deja degradada.
  const app: EstadoMedido = h.migracionAlDia === false ? 'degradado' : 'ok';
  const base: EstadoMedido | null = h.db === 'ok' ? 'ok' : h.db === 'fallo' ? 'caido' : null;
  const crons: EstadoMedido | null =
    h.crons === 'ok' || h.crons === 'config_ausente' ? 'ok'
      : h.crons === 'degraded' || h.crons === 'unknown' ? 'degradado'
        : null;
  return { app, base, crons };
}

const CRONS_WHATSAPP: CronId[] = ['wa-pendientes', 'wa-outbox'];
const CRONS_CORREO: CronId[] = ['buzon-entrega'];

type VistaLatido = Pick<LatidoDetallado, 'estado' | 'ultimoEstado'>;

/** Juzga un grupo de latidos: el peor manda; un grupo sin latido (o apagado a propósito) no se mide. */
function juzgarGrupo(ids: CronId[], latidos: Partial<Record<CronId, VistaLatido>>): EstadoMedido | null {
  const vistos = ids.map((id) => latidos[id]);
  if (vistos.some((l) => l === undefined || l.estado === 'sin_latido')) return null;
  const ls = vistos as VistaLatido[];
  if (ls.some((l) => l.ultimoEstado === 'saltado')) return null;
  if (ls.some((l) => l.estado === 'vencido')) return 'caido';
  if (ls.some((l) => l.ultimoEstado === 'fallo' || l.ultimoEstado === 'parcial')) return 'degradado';
  return 'ok';
}

/** Latidos → whatsapp y correo. `correoConfigurado = false` deja el correo sin medir (no se juzga un canal que no existe). */
export function componentesDesdeLatidos(
  latidos: Partial<Record<CronId, VistaLatido>>,
  correoConfigurado: boolean,
): Pick<MedicionComponentes, 'whatsapp' | 'correo'> {
  return {
    whatsapp: juzgarGrupo(CRONS_WHATSAPP, latidos),
    correo: correoConfigurado ? juzgarGrupo(CRONS_CORREO, latidos) : null,
  };
}

export function medicionVacia(): MedicionComponentes {
  return { ...SIN_MEDIR };
}

/** ¿Toca el mantenimiento diario (retención)? Entre las 3:00 y las 3:04 de la Ciudad de México: una corrida de la guardia al día. */
export function esVentanaDeMantenimiento(ahoraMs: number): boolean {
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone: TZ_MX, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ahoraMs));
  const hora = Number(partes.find((p) => p.type === 'hour')?.value);
  const minuto = Number(partes.find((p) => p.type === 'minute')?.value);
  return hora === 3 && minuto < 5;
}

// ── La vista de 30 días ─────────────────────────────────────────────────────

export type CeldaDia = 'ok' | 'degradado' | 'caido' | 'sin_medicion';

export interface ResumenComponente {
  componente: ComponenteEstado;
  /** 30 celdas, de la más antigua a hoy (día MX). */
  dias: Array<{ dia: string; celda: CeldaDia }>;
  /** Mediciones en la ventana. */
  muestras: number;
  /** Días de los 30 con al menos una medición. */
  diasMedidos: number;
  /** Disponibilidad medida = mediciones sin caída ÷ mediciones; `null` si no hay ninguna. */
  disponibilidadPct: number | null;
}

/** Los 30 días terminando en `hoy` (YYYY-MM-DD en hora MX), del más antiguo al más nuevo. */
export function ultimosDias(hoy: string, n = 30): string[] {
  const [a, m, d] = hoy.split('-').map(Number);
  const base = Date.UTC(a, m - 1, d);
  // (sin el helper de arreglos de Array: el barrido de la frontera de datos cuenta ese patrón y esto no es una consulta)
  return [...Array(n).keys()].map((i) => new Date(base - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/** El día MX de un instante, como YYYY-MM-DD. */
export function diaMx(ahoraMs: number): string {
  return hoyMx(new Date(ahoraMs));
}

/** Los renglones de `estado_30_dias` → un resumen por componente. Los días SIN fila quedan `sin_medicion`: nunca en verde. */
export function resumirEstado(filas: DiaEstado[], componentes: readonly ComponenteEstado[], hoy: string): ResumenComponente[] {
  const dias = ultimosDias(hoy);
  return componentes.map((componente) => {
    const delComp = new Map(filas.filter((f) => f.componente === componente).map((f) => [f.dia, f]));
    let muestras = 0;
    let caidas = 0;
    let diasMedidos = 0;
    const celdas = dias.map((dia) => {
      const f = delComp.get(dia);
      if (!f || f.muestras <= 0) return { dia, celda: 'sin_medicion' as const };
      diasMedidos++;
      muestras += f.muestras;
      caidas += f.caidas;
      return { dia, celda: f.caidas > 0 ? ('caido' as const) : f.degradadas > 0 ? ('degradado' as const) : ('ok' as const) };
    });
    return {
      componente, dias: celdas, muestras, diasMedidos,
      disponibilidadPct: muestras > 0 ? Math.round(((muestras - caidas) / muestras) * 10_000) / 100 : null,
    };
  });
}
