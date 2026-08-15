// ═══════════════════════════════════════════════════════════════════════════
// LOOP — el bucle de $50: ronda = 0 ancla → 1 doce auditores → 2 verifica →
// 4 fixers (si AUDIT_FIX=1) → 3 tablero → 5 síntesis. Cinco rondas con
// tope de presupuesto; cada ronda ancla en la síntesis de la anterior.
//
// Uso:  npx vitest run --config vitest.audit.config.ts scripts/auditoria/loop.audit.ts
// Env:  AUDIT_RONDA=1..5 · AUDIT_FIX=1 · AUDIT_SKIP_BASELINE=1 · AUDIT_CONCURRENCIA=3
// ═══════════════════════════════════════════════════════════════════════════

import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { dirRonda, rondaActual, topeRonda, cargaEnvLocal } from './config.audit';
import { correrBaseline } from './baselina.audit';
import { correrDoceAuditores } from './doce.audit';
import { verificarRonda } from './verificar.audit';
import { correrTablero } from './tablero.audit';
import { correrSintesis } from './sintesis.audit';
import { despacharFixers } from './fijar.audit';
import { aplicarFixesRonda } from './aplicar.audit';
import { resumenLedger } from './ledger.audit';

cargaEnvLocal();

export async function correrRonda(n: number): Promise<string[]> {
  const log: string[] = [];
  const dir = dirRonda(n);
  mkdirSync(dir, { recursive: true });
  const solo = (process.env.AUDIT_SOLO ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const quiere = (f: string) => solo.length === 0 || solo.includes(f);

  log.push(`═══ RONDA ${n} — tope $${topeRonda(n)} ═══`);
  if (quiere('baseline')) {
    const base = correrBaseline(n);
    log.push('FASE 0 (baseline): ' + (base.corrida ? base.resumen.join(' · ') : 'saltado'));
  } else {
    log.push('FASE 0 (baseline): saltada (AUDIT_SOLO)');
  }

  if (quiere('doce')) {
    log.push('FASE 1 (12 auditores en paralelo)…');
    const resultados = await correrDoceAuditores(n);
    log.push(`  done: ${resultados.length} rubros, ${resultados.filter((r) => r.nota !== undefined).length} con nota`);
    log.push(resumenLedger(n));
  } else {
    log.push('FASE 1 (auditores): saltada (AUDIT_SOLO)');
  }

  if (quiere('verificar')) {
    log.push('FASE 2 (verificación adversarial)…');
    const verificados = verificarRonda(n).filter((h) => h.existe);
    log.push(`  ${verificados.length} hallazgos verificados (ver docs/auditoria-${n}/verificacion.md)`);
  } else {
    log.push('FASE 2 (verificación): saltada');
  }

  if (quiere('aplicar') && process.env.AUDIT_AUTOFIX === '1') {
    log.push(`FASE 4* (fixes APLICADOS; ${hallazgos.length} verificados)…`);
    const aplicados = await aplicarFixesRonda(n);
    log.push(`  ${aplicados.filter((r) => r.estado === 'APLICADO').length} aplicados · ${aplicados.filter((r) => r.estado === 'FALSO_POSITIVO').length} falsos · ${aplicados.filter((r) => r.estado === 'ERROR').length} rechazados → docs/auditoria-${n}/fixes-aplicadas.md`);
  } else if (quiere('fixers') && process.env.AUDIT_FIX === '1') {
    log.push(`FASE 4 (fixers expertos)…`);
    const fixes = await despacharFixers(n);
    log.push(`  ${fixes.length} planes de fixer → docs/auditoria-${n}/fixes-plan.md`);
  } else {
    log.push('FASE 4 (fixers/fixes) saltada — AUDIT_AUTOFIX=1 aplica con repro, AUDIT_FIX=1 planea');
  }

  if (quiere('tablero')) {
    log.push('FASE 3 (tablero)…');
    log.push('  ' + correrTablero(n));
  } else {
    log.push('FASE 3 (tablero): saltada');
  }

  if (quiere('sintesis')) {
    log.push('FASE 5 (síntesis con Grok)…');
    await correrSintesis(n);
    log.push('  docs/auditoria-' + n + '/00-SINTESIS.md');
    log.push(resumenLedger(n));
  } else {
    log.push('FASE 5 (síntesis): saltada');
  }

  writeFileSync(`${dir}/00-ESTADO-RONDA.md`, log.join('\n'), 'utf8');
  return log;
}

export async function correrLoop(): Promise<string[]> {
  const desde = rondaActual();
  const hasta = Math.max(desde, Number(process.env.AUDIT_HASTA ?? '5'));
  const todo: string[] = [];
  for (let n = desde; n <= hasta; n++) {
    try {
      todo.push(...(await correrRonda(n)));
    } catch (err) {
      todo.push(`Ronda ${n} ABORTADA: ${String((err as Error).message ?? err)}`);
      break;
    }
  }
  return todo;
}

// ——— entrada: vitest run —config vitest.audit.config.ts scripts/auditoria/loop.audit.ts ———
test(`auditoría ronda ${process.env.AUDIT_RONDA ?? '1'} (loop, solo: ${process.env.AUDIT_SOLO ?? 'todas'})`, async () => {
  const log = await correrLoop();
  process.stdout.write(log.join('\n') + '\n');
}, 30 * 60_000);