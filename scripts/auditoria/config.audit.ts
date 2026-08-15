// ═══════════════════════════════════════════════════════════════════════════
// CONFIG DE LA AUDITORÍA — el contrato del $50.
//
// Cinco rondas de auditoría con mejora (ver loop.audit.ts), cada una con
// tope de gasto REAL (usa `costoReal` del proveedor, no la tabla), y un
// catálogo de fixers expertos que se despachan por CLASE de hallazgo.
//
// Reglas de oro del repo que se respetan aquí:
//   · Los 12 auditores NO tocan código; los fixers sí, con repro primero.
//   · Soberanía fiscal: LFPDPPP → RFC/CFDI a proveedores US/EU con ZDR.
//     `AUDIT_USE_CHINO=1` solo mientras NO haya clientes reales (dato
//     no personal). Al primer cliente: `AUDIT_USE_CHINO=0` y los roles
//     chinos se apagan solos (ver modelos.audit.ts).
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const REPO = process.cwd();
export const SKILL_REF = join(process.env.HOME ?? '/', '.claude/skills/auditoria-diaria/references');

/** Ronda de auditoría actual (1..5) y su carpeta de salida. */
export function rondaActual(): number {
  const n = Number(process.env.AUDIT_RONDA || '1');
  return Number.isFinite(n) && n >= 1 ? Math.max(1, Math.round(n)) : 1;
}
export const dirRonda = (n: number) => `${REPO}/docs/auditoria-${n}`;

/**
 * Topes de presupuesto por POSICIÓN de ronda del loop (USD).
 * La posición = n - 4 (al primer loop le toca docs/auditoria-5 = ronda 1,
 * R1 diagnostica todo, R3-5 solo diffs). Rondas > 9 vuelven a R1 del ciclo.
 */
export const TOPES_RONDA: Record<number, number> = { 1: 6.5, 2: 6.0, 3: 4.5, 4: 4.5, 5: 3.5 };
export function posicionLoop(n: number): number {
  return ((n - 4 - 1) % 5) + 1; // docs/auditoria-5 = ronda 1 del loop
}
export function topeRonda(n: number): number {
  const pos = posicionLoop(n);
  const extra = Number(process.env.AUDIT_BUDGET_USD || '0');
  return (TOPES_RONDA[pos] ?? 4.5) + (Number.isFinite(extra) && extra > 0 ? extra : 0);
}

/** Los 12 rubros (nombres de archivo destino, igual que la ronda 3). */
export const RUBROS = [
  'frontend', 'backend', 'agentico', 'tool-calling', 'seguridad',
  'fiscal', 'legal', 'arquitectura', 'pruebas', 'operabilidad',
  'rendimiento', 'datos',
] as const;
export type Rubro = (typeof RUBROS)[number];

/** Nota previa por rubro: la de CIERRE de la auditoría 3 (única síntesis completa reciente). */
export const NOTAS_PREVIAS: Record<Rubro, number> = {
  frontend: 8, backend: 7, agentico: 7, 'tool-calling': 8, seguridad: 8,
  fiscal: 7.5, legal: 6.5, arquitectura: 6, pruebas: 7, operabilidad: 6.5,
  rendimiento: 6.5, datos: 7,
};

/** ¿Usar modelos chinos en los roles de volumen? Solo en pre-revenue. */
export function usarChinos(): boolean {
  const v = (process.env.AUDIT_USE_CHINO ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}
export const CHINOS_ACTIVOS: boolean = usarChinos();

/** Carga incumbia de .env.local sin exponer secretos (valores no se loguean). */
/** Claves inyectadas por cargaEnvLocal (para poder limpiarlas en baseline). */
export const CLAVAS_INYECTADAS: string[] = [];

export function cargaEnvLocal(base: string = REPO): void {
  const p = join(base, '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const eq = l.indexOf('=');
    if (eq < 0) continue;
    const k = l.slice(0, eq).trim();
    const v = l.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (process.env[k] === undefined) {
      process.env[k] = v;
      CLAVAS_INYECTADAS.push(k);
    }
  }
}

export interface RepoSano { limpio: boolean; sucio: string[] }