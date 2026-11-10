import { supabaseAdmin } from '@/lib/supabase/admin';
import { conteo, traerTodo } from '@/lib/likida/pg';
import { acotada } from '@/lib/likida/presupuesto';
import { ahoraMs } from '@/lib/saludo';

// ═══════════════════════════════════════════════════════════════════════════
// CALIDAD POR AGENTE (F14-A, PLAN-MAESTRO §10.2): tasa de revisión humana,
// tasa de escalada, latencia y costo, por agente, desde las tablas que YA
// existen. No mide nada nuevo ni escribe nada.
//
// Contrato de honestidad (el de la casa):
//   · `null` = sin dato. Jamás un 0 con cara de medición.
//   · Una tasa con denominador < MUESTRA_MINIMA_CALIDAD es `null`: con 4 flotas
//     y 24 viajes una tasa sobre 2 casos es ruido, no una señal para la escalera.
//   · Cada fuente falla POR SEPARADO y lo dice (`fuentes`/`errores`): una tabla
//     ilegible deja su sección en `null`, las otras siguen. Se comprueba el
//     `error` de supabase-js (llega por valor) y se pagina con `traerTodo`.
//
// LO QUE NO SE PUEDE MEDIR HOY (y se dice):
//   · Escalada: `orquestador_escalacion` no guarda agente y no hay denominador
//     de «interacciones» por agente; solo se cuentan las escaladas del
//     orquestador y la tasa queda en `null`.
//   · Costo: `llm_costo` no guarda agente; el costo por agente sale de
//     `agente_corrida.costo_usd`, que es NULL cuando la corrida no se midió.
// ═══════════════════════════════════════════════════════════════════════════

export const MUESTRA_MINIMA_CALIDAD = 5;

/** Espejo de `RESOLUTOR_AUTOMATICO` (enviador.ts). Se repite el literal para no
 *  arrastrar el enviador (Resend, etc.) a un lector de panel; la prueba compara
 *  el fuente y falla si divergen. */
export const RESOLUTOR_AUTOMATICO_ESPEJO = 'enviador@automatico';

// ── Parte pura ─────────────────────────────────────────────────────────────

/** Tasa o `null` si el denominador no alcanza la muestra mínima. */
export function tasa(numerador: number, denominador: number): number | null {
  if (!Number.isFinite(numerador) || !Number.isFinite(denominador)) return null;
  if (denominador < MUESTRA_MINIMA_CALIDAD || numerador < 0 || numerador > denominador) return null;
  return Math.round((numerador / denominador) * 1000) / 1000;
}

export interface PiezaCola {
  agente: string;
  estado: 'pendiente' | 'aprobado' | 'rechazado';
  cuerpo_final: string | null;
  resuelto_por_email: string | null;
}

export interface RevisionAgente {
  /** Piezas que el agente puso en la bandeja en la ventana. */
  piezas: number;
  /** Resueltas por una PERSONA (no la auto-aprobación del enviador). */
  revisadasPorHumano: number;
  /** De esas, rechazadas o aprobadas con edición. */
  corregidas: number;
  /** revisadasPorHumano / piezas. */
  tasaRevisionHumana: number | null;
  /** corregidas / revisadasPorHumano. */
  tasaCorreccion: number | null;
}

export function resumirRevision(filas: ReadonlyArray<PiezaCola>): Map<string, RevisionAgente> {
  const acc = new Map<string, { piezas: number; hum: number; corr: number }>();
  for (const f of filas) {
    const a = acc.get(f.agente) ?? { piezas: 0, hum: 0, corr: 0 };
    a.piezas++;
    const resueltaPorHumano = f.estado !== 'pendiente'
      && !!f.resuelto_por_email && f.resuelto_por_email !== RESOLUTOR_AUTOMATICO_ESPEJO;
    if (resueltaPorHumano) {
      a.hum++;
      if (f.estado === 'rechazado' || (f.cuerpo_final !== null && f.cuerpo_final !== '')) a.corr++;
    }
    acc.set(f.agente, a);
  }
  const out = new Map<string, RevisionAgente>();
  for (const [agente, a] of acc) {
    out.set(agente, {
      piezas: a.piezas, revisadasPorHumano: a.hum, corregidas: a.corr,
      tasaRevisionHumana: tasa(a.hum, a.piezas), tasaCorreccion: tasa(a.corr, a.hum),
    });
  }
  return out;
}

export interface CorridaMedida {
  agente: string;
  inicio: string;
  fin: string | null;
  estado: 'ok' | 'parcial' | 'fallo';
  costo_usd: number | string | null;
}

export interface CorridasAgente {
  total: number;
  /** Con fin y duración no negativa. */
  medibles: number;
  p50Ms: number | null;
  p95Ms: number | null;
  /** Corridas con `costo_usd` medido (NULL = no medido, NO 0). */
  conCosto: number;
  costoUsdTotal: number | null;
  costoPorCorridaUsd: number | null;
}

/** Rango más cercano (`percentile_disc`): un valor que de verdad ocurrió. */
export function percentil(ordenados: readonly number[], p: number): number | null {
  if (ordenados.length === 0) return null;
  const i = Math.min(ordenados.length - 1, Math.max(0, Math.ceil(p * ordenados.length) - 1));
  return ordenados[i];
}

export function resumirCorridasAgente(filas: ReadonlyArray<CorridaMedida>): Map<string, CorridasAgente> {
  const por = new Map<string, CorridaMedida[]>();
  for (const f of filas) por.set(f.agente, [...(por.get(f.agente) ?? []), f]);
  const out = new Map<string, CorridasAgente>();
  for (const [agente, fs] of por) {
    const dur = fs
      .map((f) => (f.fin ? Date.parse(f.fin) - Date.parse(f.inicio) : NaN))
      .filter((d) => Number.isFinite(d) && d >= 0)
      .sort((a, b) => a - b);
    const costos = fs
      .map((f) => (f.costo_usd === null || f.costo_usd === undefined ? NaN : Number(f.costo_usd)))
      .filter((c) => Number.isFinite(c) && c >= 0);
    const suficiente = dur.length >= MUESTRA_MINIMA_CALIDAD;
    const total$ = costos.reduce((s, c) => s + c, 0);
    out.set(agente, {
      total: fs.length,
      medibles: dur.length,
      p50Ms: suficiente ? percentil(dur, 0.5) : null,
      p95Ms: suficiente ? percentil(dur, 0.95) : null,
      conCosto: costos.length,
      costoUsdTotal: costos.length > 0 ? Math.round(total$ * 1e6) / 1e6 : null,
      costoPorCorridaUsd: costos.length >= MUESTRA_MINIMA_CALIDAD ? Math.round((total$ / costos.length) * 1e6) / 1e6 : null,
    });
  }
  return out;
}

export interface EscaladaAgente {
  /** Escaladas contadas; `null` = no medido para este agente. */
  escaladas: number | null;
  /** Escaladas / interacciones. Hoy siempre `null`: no hay denominador. */
  tasa: number | null;
  nota: string;
}

const NOTA_ESCALADA_SIN_DATO = 'No medido: la escalada de este agente no se registra por agente.';
const NOTA_ESCALADA_ORQUESTADOR = 'Se cuentan las escaladas; la tasa es «sin dato» porque no hay denominador de interacciones.';

// ── Lector ─────────────────────────────────────────────────────────────────

export interface CalidadAgente {
  agente: string;
  /** `null` = la fuente no se pudo leer (≠ «sin piezas»: eso es un objeto sin la fila). */
  revision: RevisionAgente | null;
  escalada: EscaladaAgente;
  corridas: CorridasAgente | null;
}

export type EstadoFuente = 'ok' | 'error';

export interface CalidadAgentes {
  ventanaDias: number;
  desde: string;
  agentes: CalidadAgente[];
  fuentes: { cola: EstadoFuente; corridas: EstadoFuente; escalaciones: EstadoFuente };
  errores: string[];
}

export async function getCalidadAgentes(ventanaDias = 30): Promise<CalidadAgentes> {
  const admin = supabaseAdmin();
  const desde = new Date(ahoraMs() - ventanaDias * 86_400_000).toISOString();
  const errores: string[] = [];

  const [cola, corridas, escaladas] = await Promise.all([
    (async () => {
      try {
        return resumirRevision(await traerTodo<PiezaCola>(
          (d, h) => acotada(
            admin.from('cola_aprobacion')
              .select('agente, estado, cuerpo_final, resuelto_por_email', conteo(d))
              .gte('creado_en', desde)
              .order('creado_en', { ascending: false }).order('id', { ascending: true })
              .range(d, h),
            'calidad_agentes.cola',
          ),
          'calidad_agentes.cola',
        ));
      } catch (e) { errores.push(`cola_aprobacion: ${e instanceof Error ? e.message : String(e)}`); return null; }
    })(),
    (async () => {
      try {
        return resumirCorridasAgente(await traerTodo<CorridaMedida>(
          (d, h) => acotada(
            admin.from('agente_corrida')
              .select('agente, inicio, fin, estado, costo_usd', conteo(d))
              .gte('inicio', desde)
              .order('inicio', { ascending: false }).order('id', { ascending: true })
              .range(d, h),
            'calidad_agentes.corridas',
          ),
          'calidad_agentes.corridas',
        ));
      } catch (e) { errores.push(`agente_corrida: ${e instanceof Error ? e.message : String(e)}`); return null; }
    })(),
    (async (): Promise<number | null> => {
      try {
        const { count, error } = await acotada(
          admin.from('orquestador_escalacion').select('id', { count: 'exact', head: true }).gte('creada_en', desde),
          'calidad_agentes.escalaciones',
        );
        if (error) throw new Error(error.message);
        if (typeof count !== 'number') throw new Error('sin conteo');
        return count;
      } catch (e) { errores.push(`orquestador_escalacion: ${e instanceof Error ? e.message : String(e)}`); return null; }
    })(),
  ]);

  const ids = new Set<string>([...(cola?.keys() ?? []), ...(corridas?.keys() ?? [])]);
  if (escaladas !== null && escaladas > 0) ids.add('orquestador');
  const agentes: CalidadAgente[] = [...ids].sort().map((agente) => ({
    agente,
    revision: cola === null ? null : (cola.get(agente) ?? null),
    escalada: agente === 'orquestador'
      ? { escaladas: escaladas, tasa: null, nota: escaladas === null ? NOTA_ESCALADA_SIN_DATO : NOTA_ESCALADA_ORQUESTADOR }
      : { escaladas: null, tasa: null, nota: NOTA_ESCALADA_SIN_DATO },
    corridas: corridas === null ? null : (corridas.get(agente) ?? null),
  }));

  return {
    ventanaDias, desde, agentes, errores,
    fuentes: {
      cola: cola === null ? 'error' : 'ok',
      corridas: corridas === null ? 'error' : 'ok',
      escalaciones: escaladas === null ? 'error' : 'ok',
    },
  };
}
