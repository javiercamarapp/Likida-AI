// ═══════════════════════════════════════════════════════════════════════════
// PANEL DE QA (/admin/qa) — Fase A — tipos y validación compartidos.
//
// Client-safe a propósito: cero imports de node, para que el formulario
// ('use client') y el servidor hablen el mismo contrato. El contrato del
// veredicto calca `VeredictoOraculo` de scripts/qa-agentes/config.qa.ts (la
// Fase 1 del ejército de QA) — no se reescribe la semántica, solo se le da
// forma de fila de tabla para la pantalla.
//
// MODELO DE DATOS (Fase B, 24-ago-2026): las tablas `qa_corrida` /
// `qa_corrida_paso` / `qa_foto` del diseño (00-PANEL-DE-QA.md §4) YA EXISTEN
// — migración 0185. La Fase A había guardado el estado como JSON en Storage
// porque las migraciones estaban congeladas esperando el token de Supabase;
// ese motivo caducó y el ledger se importó con
// `scripts/qa/importar-ledger.ts`. En Storage solo quedan los BYTES: las
// imágenes en `qa-fotos` y los PDF del cierre en `qa-evidencia`.
// ═══════════════════════════════════════════════════════════════════════════

import type { PoliticaGasto } from '@/lib/likida/cuadre/engine';

export type EstadoCorrida = 'pendiente' | 'corriendo' | 'ok' | 'parcial' | 'fallo' | 'abortada';
export type EstadoPaso = 'pendiente' | 'corriendo' | 'ok' | 'warn' | 'bad';
export type Retencion = 'borrar_al_terminar' | 'conservar';
export type EscenarioId = 'feliz' | 'demo_guion' | 'foto_duplicada';

/** Los escenarios que el selector ofrece HOY. Vive aquí (client-safe) porque
 *  el validador del servidor y el formulario tienen que estar de acuerdo, y
 *  qa-escenarios.ts importa este tipo — no al revés. El catálogo del diseño
 *  tiene 11; los que faltan no se ofrecen, y el rechazo lo DICE. */
export const ESCENARIOS_VALIDOS: readonly EscenarioId[] = ['feliz', 'demo_guion', 'foto_duplicada'];

/** Una foto del banco (tabla `qa_foto`, mig. 0185; los bytes en el bucket
 *  qa-fotos). `ocrEsperado` sigue siendo `null` en el tipo hasta que la
 *  pantalla del oráculo humano exista — la columna ya lo admite, y su CHECK
 *  impide un "esperado" sin quién lo firmó. */
export interface FotoBanco {
  id: string;
  /** sha256 de los BYTES del archivo — el mismo criterio que `img_hash` de
   *  producción (`hashImagen`), para que el dedup del banco y el de la base
   *  hablen del mismo hash. */
  hash: string;
  path: string;          // ruta dentro del bucket qa-fotos
  mime: string;
  etiqueta: string;      // hoy: el nombre original del archivo (nadie etiquetó aún)
  bytes: number;
  subidoEn: string;
  ocrEsperado: null;
}

export interface PasoQA {
  n: number;
  nombre: string;
  estado: EstadoPaso;
  /** Costo REAL de este paso, leído de llm_costo (fases ≠ whatsapp) — nunca
   *  una estimación. */
  costoUsd: number;
  detalle?: string;
  inicio?: string;
  fin?: string;
}

export interface FilaVeredicto {
  invariante: string;    // "#1  anticipo − gastos = diferencia"
  oraculo: string;       // "cuadre_balancea (#1)"
  estado: 'ok' | 'fallo' | 'no_verificado';
  severidad: string;     // CRÍTICO | ALTO | MEDIO — la del invariante, aplica si falla
  esperado: unknown;
  real: unknown;
  detalle?: string;
}

export interface TurnoConversacion { rol: 'user' | 'assistant'; texto: string }

export interface ParametrosCorrida {
  anticipo: number;
  rfcEmpresa: string | null;
  ruta: { origen: string; destino: string };
  politica: PoliticaGasto[];
  fotoIds: string[];
  retencion: Retencion;
}

export interface CorridaQA {
  id: string;
  escenario: EscenarioId;
  carril: 'rapido';      // el carril completo (GitHub Actions) es Fase C
  // (la columna de la 0185 ya admite 'completo': la Fase C no pide DDL, solo
  //  abrir este literal y escribir el workflow.)
  parametros: ParametrosCorrida;
  estado: EstadoCorrida;
  /** Por qué se abortó / qué motivo tiene el estado — dicho, nunca en silencio. */
  motivo: string | null;
  tenantId: string | null;
  tenantNombre: string;
  creadaEn: string;
  inicio: string | null;
  fin: string | null;
  /** Última señal de vida del motor: cada escritura de paso lo actualiza. La
   *  pantalla lo usa para decir "sin señales desde hace Ns" si el proceso
   *  murió sin poder escribir su aborto (fallar cerrado en la LECTURA). */
  latidoEn: string;
  pasos: PasoQA[];
  costoUsdTotal: number;
  veredicto: FilaVeredicto[] | null;
  /** La conversación completa (turnos de wa_conversacion): la evidencia de
   *  qué dijo el chofer sintético y qué contestó el sistema. */
  turnos: TurnoConversacion[];
  /** Rutas de PDF que el cierre dejó en el bucket `liquidaciones`. */
  pdfs: string[];
  limpieza: string | null;
}

/** Tope del carril rápido (00-PANEL-DE-QA.md §3): más fotos que esto necesita
 *  el carril completo (Fase C) — el botón lo dice, no falla en silencio. */
export const MAX_FOTOS_CARRIL_RAPIDO = 10;

/** Tope diario del panel (00-PANEL-DE-QA.md §6, default $5). Vive aquí
 *  (client-safe) porque el botón lo enseña; el CANDADO real lo aplica el
 *  servidor (lanzar/route.ts) con el gasto leído, nunca solo la interfaz. */
export const TOPE_DIA_USD = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RFC_RE = /^[A-ZÑ&0-9]{12,13}$/;

export interface LanzarValidado {
  escenario: EscenarioId;
  params: ParametrosCorrida;
}

/** Valida el body del POST /api/admin/qa/lanzar. El cliente no es frontera de
 *  confianza (mismo criterio que valida /api/admin/copiloto): todo se
 *  re-chequea aquí y el motivo del rechazo se dice. */
export function validarLanzar(crudo: unknown): { ok: true; datos: LanzarValidado } | { ok: false; error: string } {
  const b = crudo as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return { ok: false, error: 'body inválido' };

  const escenario = b.escenario as EscenarioId;
  if (!ESCENARIOS_VALIDOS.includes(escenario)) {
    return { ok: false, error: `escenario desconocido — los del selector son ${ESCENARIOS_VALIDOS.map((e) => `"${e}"`).join(', ')}; los ${11 - ESCENARIOS_VALIDOS.length} restantes del catálogo siguen pendientes` };
  }

  const fotoIds = b.fotoIds;
  if (!Array.isArray(fotoIds) || fotoIds.length === 0) return { ok: false, error: 'elige al menos una foto del banco' };
  if (fotoIds.length > MAX_FOTOS_CARRIL_RAPIDO) {
    return { ok: false, error: `más de ${MAX_FOTOS_CARRIL_RAPIDO} fotos no cabe en el carril rápido — eso es carril completo (Fase C)` };
  }
  if (!fotoIds.every((f) => typeof f === 'string' && UUID_RE.test(f))) return { ok: false, error: 'fotoIds inválidos' };

  const anticipo = Number(b.anticipo);
  if (!Number.isFinite(anticipo) || anticipo <= 0 || anticipo > 10_000_000) {
    return { ok: false, error: 'anticipo inválido — debe ser un monto mayor a 0' };
  }

  let rfcEmpresa: string | null = null;
  if (b.rfcEmpresa !== null && b.rfcEmpresa !== undefined && b.rfcEmpresa !== '') {
    if (typeof b.rfcEmpresa !== 'string') return { ok: false, error: 'rfcEmpresa inválido' };
    const rfc = b.rfcEmpresa.toUpperCase().replace(/[^A-ZÑ&0-9]/g, '');
    if (!RFC_RE.test(rfc)) return { ok: false, error: 'rfcEmpresa inválido — 12 o 13 caracteres de RFC' };
    rfcEmpresa = rfc;
  }

  const ruta = b.ruta as Record<string, unknown> | null;
  const origen = typeof ruta?.origen === 'string' ? ruta.origen.trim().slice(0, 80) : '';
  const destino = typeof ruta?.destino === 'string' ? ruta.destino.trim().slice(0, 80) : '';
  if (!origen || !destino) return { ok: false, error: 'ruta incompleta — origen y destino' };

  const politicaCruda = b.politica;
  if (!Array.isArray(politicaCruda) || politicaCruda.length === 0 || politicaCruda.length > 20) {
    return { ok: false, error: 'política inválida — de 1 a 20 conceptos' };
  }
  const politica: PoliticaGasto[] = [];
  for (const p of politicaCruda) {
    const fila = p as Record<string, unknown>;
    const concepto = typeof fila?.concepto === 'string' ? fila.concepto.trim().toLowerCase().slice(0, 40) : '';
    if (!concepto) return { ok: false, error: 'política inválida — un concepto está vacío' };
    const entrada: PoliticaGasto = { concepto };
    if (fila.topeMonto !== undefined && fila.topeMonto !== null && fila.topeMonto !== '') {
      const tope = Number(fila.topeMonto);
      if (!Number.isFinite(tope) || tope < 0 || tope > 10_000_000) return { ok: false, error: `política inválida — tope de "${concepto}"` };
      entrada.topeMonto = tope;
    }
    if (fila.requiereCfdi === true) entrada.requiereCfdi = true;
    politica.push(entrada);
  }

  const retencion: Retencion = b.retencion === 'conservar' ? 'conservar' : 'borrar_al_terminar';

  return {
    ok: true,
    datos: {
      escenario,
      params: { anticipo, rfcEmpresa, ruta: { origen, destino }, politica, fotoIds: fotoIds as string[], retencion },
    },
  };
}

/** El estado final de una corrida a partir de su veredicto: cualquier fallo
 *  manda (fallo), lo no verificado NO cuenta como pasó (parcial — regla
 *  "fallar cerrado y decirlo"), y solo ok limpio es ok. */
export function estadoFinalDe(veredicto: FilaVeredicto[]): Extract<EstadoCorrida, 'ok' | 'parcial' | 'fallo'> {
  if (veredicto.some((v) => v.estado === 'fallo')) return 'fallo';
  if (veredicto.some((v) => v.estado === 'no_verificado')) return 'parcial';
  return 'ok';
}

/** Conteo ✅/⚠️/❌ para el historial. */
export function resumenVeredicto(veredicto: FilaVeredicto[] | null): { ok: number; noVerificado: number; fallo: number } | null {
  if (!veredicto) return null;
  return {
    ok: veredicto.filter((v) => v.estado === 'ok').length,
    noVerificado: veredicto.filter((v) => v.estado === 'no_verificado').length,
    fallo: veredicto.filter((v) => v.estado === 'fallo').length,
  };
}
