// ═══════════════════════════════════════════════════════════════════════════
// MODELOS DE LA AUDITORÍA — el mix decidido con Javier (2026-08-15).
//
//   DeepSeek V4 Flash     →  volumen barato (escaneo, fixes mecánicos)
//   DeepSeek V4 Pro 0813  →  los 12 auditores (agentic 49.6, 1M ctx,
//                            Terminal-Bench 87.9 > Opus 4.8) y fixes medios
//   Gemini 3.7 Flash      →  visión (frontend/fiscal/legal) + razón media
//   GPT-5.6 Luna          →  verificación adversarial + volumen de código
//   Grok 4.6              →  síntesis del delta, críticos y juicio
//                            arquitectónico (intel 60.9 / agentic 58.7)
//
// FIXERS EXPERTOS — catálogo de 11 rutinas (Javier, 15-ago-2026) + seguridad,
// fiscal y rendimiento. Cada fixer se despacha por CLASE de hallazgo y se
// corre con el modelo que su clase exige (profundo→Grok/DeepSeek-Pro,
// mecánico→DeepSeek-Flash/Luna, visión→Gemini).
//
// CANDADO DE SOBERANÍA: los roles chinos (deepseek-*) se anulan cuando
// entra el primer cliente real (AUDIT_USE_CHINO=0). Los rubros fiscal y
// legal usan SOLO US (Gemini/Luna) — RFC/CFDI es dato personal.
// ═══════════════════════════════════════════════════════════════════════════

import type { Rubro } from './config.audit';
import { CHINOS_ACTIVOS } from './config.audit';

export const M = {
  flashChino: 'deepseek/deepseek-v4-flash-0731',   // $0.14/$0.28 — volumen
  proChino: 'deepseek/deepseek-v4-pro-0813',       // $0.43/$0.87 — auditores + fixes medios
  gemini: 'google/gemini-3.7-flash',               // $0.375/$1.875 — visión + lectura fina
  luna: 'openai/gpt-5.6-luna',                     // $0.10/$0.60 — verificación/volumen
  grok: 'x-ai/grok-4.6',                           // $2/$6 — juicio crítico, dosis chicas
} as const;

/** Modelo por RUBRO (los 12 auditores). */
/** Modelo por RUBRO (los 12 auditores). */
export function modeloRubro(r: Rubro): string {
  // Rubros de visión/documentos → solo US (Gemini ve PDFs y renders).
  if (r === 'fiscal' || r === 'legal' || r === 'frontend') return M.gemini;
  // Razonamiento profundo (agéntico, seguridad, rendimiento): DeepSeek Pro
  // 0813 SOLO si AUDIT_DEEPSEEK_PRO=1 — su único proveedor (DeepSeek CN)
  // no soporta data_collection:deny, así que por defecto se usa Flash
  // (Baidu, ZDR ✅, coding 69.1 > 68.8). USD si candado cerrado.
  if (r === 'agentico' || r === 'seguridad' || r === 'rendimiento') {
    if (!CHINOS_ACTIVOS) return M.gemini;
    return profundidadExtra() ? M.proChino : M.flashChino;
  }
  // Volumen: Flash 0731 (Baidu, ZDR OK) — mejor precio/codigo del tablero.
  return CHINOS_ACTIVOS ? M.flashChino : M.gemini;
}

export function profundidadExtra(): boolean {
  // V4 Pro 0813 SÍ está en OpenRouter (GA 12-ago-2026, proveedor DeepSeek).
  // Conviene en los rubros de razonamiento; su costo es 3x Flash pero su
  // agentic 49.6 / intel 53.2 son los mejores de la línea barata. Se apaga
  // con AUDIT_DEEPSEEK_PRO=0 (por ejemplo, si hace falta ZDR estricto).
  return (process.env.AUDIT_DEEPSEEK_PRO ?? '1') !== '0';
}

/** Modelo de la verificación adversarial (fase 3): segundo lector barato. */
export const MODELO_VERIFICADOR: string = M.luna;

/** Modelo de la síntesis final (fase 5): el criterio del delta. */
export const MODELO_SINTESIS: string = M.grok;

export type Severidad = 'CRITICO' | 'ALTO' | 'MEDIO' | 'BAJO';
export type ClaseFixer =
  | 'crash' | 'logic-debug' | 'flaky' | 'layering' | 'dup' | 'inlined'
  | 'logic-simplifier' | 'ant-shipper' | 'dead-code' | 'useless-pruner'
  | 'abstraction' | 'seguridad' | 'fiscal' | 'rendimiento';

export interface FixerDef {
  id: ClaseFixer;
  nombre: string;
  queHace: string;
  modelo: (r: Rubro) => string;
}

type ModelSeveridad = 'CRITICO' | 'ALTO' | 'MEDIO' | 'BAJO';

/** Catálogo de fixers (la tabla de la imagen). */
export const FIXERS: FixerDef[] = [
  { id: 'crash',        nombre: 'Crash fuzzer',        queHace: 'Encuentra crashes reales y abre fixes de causa raíz',                     modelo: () => M.grok },
  { id: 'logic-debug',  nombre: 'Logic bugfixer',      queHace: 'Modela lógica tramposa para encontrar y arreglar bugs',                   modelo: () => (profundidadExtra() ? M.proChino : M.flashChino) },
  { id: 'flaky',        nombre: 'Flaky-test fixer',    queHace: 'Enraíza tests que fallan de noche en CI',                                 modelo: () => M.grok },
  { id: 'layering',     nombre: 'Abstraction police',  queHace: 'Arregla violaciones de capas',                                            modelo: () => M.grok },
  { id: 'dup',          nombre: 'Dup unifier',         queHace: 'Funde implementaciones duplicadas',                                       modelo: () => M.luna },
  { id: 'inlined',      nombre: 'Shipped-feature inliner', queHace: 'Quita flags de features ya desplegadas',                             modelo: () => M.gemini },
  { id: 'logic-simplifier', nombre: 'Logic simplifier',queHace: 'Simplifica lógica de negocio enredada',                                  modelo: () => M.gemini },
  { id: 'dead-code',    nombre: 'Dead-code removal',   queHace: 'Borra código demostrablemente inalcanzable',                              modelo: () => M.flashChino },
  { id: 'useless-pruner', nombre: 'Useless-test pruner', queHace: 'Borra tests que no pueden fallar',                                     modelo: () => M.flashChino },
  { id: 'abstraction',  nombre: 'Abstraction improver',queHace: 'Aplana abstracciones sobre-ingenierizadas',                              modelo: () => M.gemini },
  // Propios de Likida (no están en la imagen pero el dominio los exige):
  { id: 'seguridad',    nombre: 'Security sealer',    queHace: 'Cierra hallazgos de seguridad con repro y candado estructural',           modelo: () => M.grok },
  { id: 'fiscal',       nombre: 'Fiscal facts keeper',queHace: 'Corrige cumplimiento fiscal contra normas/*.yaml',                        modelo: () => M.gemini },
  { id: 'rendimiento',  nombre: 'Perf mechanics',     queHace: 'Acota cuellos de botella medibles (reloj, lotes, índices)',               modelo: () => (profundidadExtra() ? M.proChino : M.flashChino) },
];

/** Fixer según severidad + rubro cuando el ID de clase no se puede determinar. */
export function fixerPorSeveridad(r: Rubro, sev: ModelSeveridad, reincidente = false): FixerDef {
  // Los rubros que la image cataloga con dueño fijo:
  if (r === 'seguridad') return byId('seguridad');
  if (r === 'fiscal') return byId('fiscal');
  if (r === 'rendimiento') return byId('rendimiento');
  // Severidad → clase:
  if (sev === 'CRITICO') return byId('crash');
  if (sev === 'ALTO') return byId('logic-debug');
  if (sev === 'MEDIO') return byId('dup');
  if (sev === 'BAJO') return byId('useless-pruner');
  return byId('logic-debug');
}
export function byId(id: ClaseFixer): FixerDef {
  const f = FIXERS.find((x) => x.id === id);
  if (!f) throw new Error(`fixer desconocido: ${id}`);
  return f;
}

export function severidadDeTexto(t: string): ModelSeveridad {
  const s = t.toUpperCase();
  if (s.includes('CRIT')) return 'CRITICO';
  if (s.includes('ALTO')) return 'ALTO';
  if (s.includes('MEDIO')) return 'MEDIO';
  return 'BAJO';
}